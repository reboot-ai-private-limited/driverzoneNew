import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import type { AdminRole, Role } from '@driverzone/contracts';
import { hashOtpCode, type OtpChallenge, type OtpPurpose } from '../src/modules/identity/domain/otpChallenge.entity.js';
import type { OtpStorePort } from '../src/modules/identity/domain/otpStore.port.js';
import type { OtpSenderPort } from '../src/modules/identity/domain/otpSender.port.js';
import type { Account, AccountRepositoryPort } from '../src/modules/identity/domain/account.repository.port.js';
import type { SessionRepositoryPort } from '../src/modules/identity/domain/session.repository.port.js';
import type { AuditEntry, AuditPort } from '../src/modules/identity/domain/audit.port.js';
import type {
  AdminRosterEntry,
  AdminRosterRepositoryPort,
} from '../src/modules/identity/domain/adminRoster.repository.port.js';
import type { AdminProfileRepositoryPort } from '../src/modules/identity/domain/adminProfile.repository.port.js';
import { SendOtpUseCase } from '../src/modules/identity/application/useCases/sendOtp.usecase.js';
import { VerifyOtpUseCase } from '../src/modules/identity/application/useCases/verifyOtp.usecase.js';
import { RefreshSessionUseCase } from '../src/modules/identity/application/useCases/refreshSession.usecase.js';
import { ManageAdminsUseCase } from '../src/modules/identity/application/useCases/manageAdmins.usecase.js';
import { CloseAccountUseCase } from '../src/modules/identity/application/useCases/closeAccount.usecase.js';
import { OtpChallengeVerifier } from '../src/modules/identity/application/otpChallengeVerifier.js';
import { TokenIssuer } from '../src/modules/identity/application/tokenIssuer.js';
import { makeRequireSuperAdmin } from '../src/modules/identity/interface/requireSuperAdmin.js';
import { hashRefreshToken } from '../src/modules/identity/domain/session.entity.js';
import { signRefreshToken } from '../src/shared/security/jwt.js';
import { deletionBlockers, forfeitedCreditPaise } from '../src/modules/accounts/domain/deletionBlockers.js';
import { DeleteAccountUseCase } from '../src/modules/accounts/application/deleteAccount.usecase.js';
import type {
  AccountClosureContract,
  ClosableAccount,
  ClosedBy,
} from '../src/modules/identity/identity.public.js';
import type { AppError } from '../src/shared/errors/AppError.js';

/**
 * Admin roles and account deletion, exercised without Mongo, Redis or Express — the same approach
 * as `identity.test.ts`. The store fake here is keyed by PURPOSE as well as number, because the
 * rule most worth pinning is that a deletion code and a login code never meet.
 */

const PEPPER = 'test-pepper-value-that-is-long-enough';

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'DID_NOT_THROW';
  } catch (err) {
    return (err as AppError).code;
  }
}

// ─── Fakes ──────────────────────────────────────────────────────────────────────────────────

function purposeStore(): OtpStorePort & { challenges: Map<string, OtpChallenge> } {
  const challenges = new Map<string, OtpChallenge>();
  const key = (role: Role, phone: string, purpose: OtpPurpose = 'LOGIN') => `${purpose}:${role}:${phone}`;
  return {
    challenges,
    save: (role, phone, challenge, _ttl, purpose) => {
      challenges.set(key(role, phone, purpose), { ...challenge });
      return Promise.resolve();
    },
    find: (role, phone, purpose) => Promise.resolve(challenges.get(key(role, phone, purpose))),
    recordAttempt: (role, phone, purpose) => {
      const c = challenges.get(key(role, phone, purpose));
      if (c === undefined) return Promise.resolve(undefined);
      c.attempts += 1;
      return Promise.resolve(c.attempts);
    },
    burn: (role, phone, purpose) => {
      challenges.delete(key(role, phone, purpose));
      return Promise.resolve();
    },
    cooldownRemaining: () => Promise.resolve(0),
    startCooldown: () => Promise.resolve(),
    countSend: () => Promise.resolve({ count: 1, ttlSeconds: 3600 }),
  };
}

function capturingSender(): OtpSenderPort & { codes: string[] } {
  const codes: string[] = [];
  return {
    codes,
    send: (_role, _phone, code) => {
      codes.push(code);
      return Promise.resolve();
    },
  };
}

function accountsWith(account?: Account): AccountRepositoryPort {
  return {
    findByPhone: () => Promise.resolve(account),
    findById: () => Promise.resolve(account),
    create: (_role, phone) => Promise.resolve({ id: 'acc_new', mobileNumber: phone, fullName: null, isBlocked: false }),
  };
}

function recordingSessions(): SessionRepositoryPort & { revokedUsers: string[]; families: string[] } {
  const revokedUsers: string[] = [];
  const families: string[] = [];
  return {
    revokedUsers,
    families,
    create: () => Promise.resolve(),
    findBySessionId: (sessionId) =>
      Promise.resolve({
        sessionId,
        userId: 'acc_1',
        role: 'CUSTOMER',
        tokenHash: '',
        familyId: 'fam_1',
        expiresAt: new Date(Date.now() + 60_000),
      }),
    markUsed: () => Promise.resolve(true),
    revokeFamily: (familyId) => {
      families.push(familyId);
      return Promise.resolve();
    },
    revokeSession: () => Promise.resolve(),
    revokeAllForUser: (userId) => {
      revokedUsers.push(userId);
      return Promise.resolve();
    },
  };
}

function recordingAudit(): AuditPort & { entries: AuditEntry[] } {
  const entries: AuditEntry[] = [];
  return {
    entries,
    record: (entry) => {
      entries.push(entry);
      return Promise.resolve();
    },
  };
}

const CUSTOMER: Account = { id: 'cus_1', mobileNumber: '+919000000003', fullName: 'C', isBlocked: false };

// ─── OTP purposes ───────────────────────────────────────────────────────────────────────────

describe('OTP purposes', () => {
  it('stores a deletion code in its own slot, so it cannot sign anybody in', async () => {
    const store = purposeStore();
    const sender = capturingSender();
    const send = new SendOtpUseCase(store, sender, accountsWith(CUSTOMER), PEPPER);
    const verify = new VerifyOtpUseCase(store, accountsWith(CUSTOMER), new TokenIssuer(recordingSessions()), PEPPER);

    await send.execute({ role: 'CUSTOMER', phone: CUSTOMER.mobileNumber, purpose: 'DELETE_ACCOUNT' });
    const code = sender.codes[0] ?? '';

    expect(await codeOf(verify.execute({ role: 'CUSTOMER', phone: CUSTOMER.mobileNumber, code }))).toBe(
      'OTP_INVALID_OR_EXPIRED',
    );
    // And the deletion code is still there to be spent by the flow it was sent for.
    await new OtpChallengeVerifier(store, PEPPER).check('CUSTOMER', CUSTOMER.mobileNumber, code, 'DELETE_ACCOUNT');
  });

  it('will not spend a login code on account deletion', async () => {
    const store = purposeStore();
    await store.save('CUSTOMER', CUSTOMER.mobileNumber, { codeHash: hashOtpCode('111111', PEPPER), attempts: 0 }, 300);

    expect(
      await codeOf(
        new OtpChallengeVerifier(store, PEPPER).check('CUSTOMER', CUSTOMER.mobileNumber, '111111', 'DELETE_ACCOUNT'),
      ),
    ).toBe('OTP_INVALID_OR_EXPIRED');
  });

  /** The deletion form must not tell an anonymous caller which numbers have accounts. */
  it('answers a deletion request for an unknown number identically, but sends nothing', async () => {
    const sender = capturingSender();
    const send = new SendOtpUseCase(purposeStore(), sender, accountsWith(undefined), PEPPER);

    const result = await send.execute({ role: 'CUSTOMER', phone: '+919999999999', purpose: 'DELETE_ACCOUNT' });

    expect(result.expiresInSeconds).toBeGreaterThan(0);
    expect(sender.codes).toHaveLength(0);
  });

  /** Suspension is not a reason to keep somebody's data against their wishes. */
  it('lets a suspended user get a deletion code, while still refusing them a login code', async () => {
    const sender = capturingSender();
    const blocked = { ...CUSTOMER, isBlocked: true };
    const send = new SendOtpUseCase(purposeStore(), sender, accountsWith(blocked), PEPPER);

    await send.execute({ role: 'CUSTOMER', phone: blocked.mobileNumber, purpose: 'DELETE_ACCOUNT' });
    expect(sender.codes).toHaveLength(1);

    expect(await codeOf(send.execute({ role: 'CUSTOMER', phone: blocked.mobileNumber }))).toBe('FORBIDDEN');
  });

  it('never sends an admin a deletion code', async () => {
    const sender = capturingSender();
    const send = new SendOtpUseCase(purposeStore(), sender, accountsWith(CUSTOMER), PEPPER);

    await send.execute({ role: 'ADMIN', phone: CUSTOMER.mobileNumber, purpose: 'DELETE_ACCOUNT' });

    expect(sender.codes).toHaveLength(0);
  });
});

// ─── Refresh ────────────────────────────────────────────────────────────────────────────────

describe('RefreshSessionUseCase — the account must still exist', () => {
  it('refuses, and revokes everything, when the account is gone', async () => {
    const token = await signRefreshToken({ sub: 'acc_1', role: 'CUSTOMER', sid: 'ses_1' });
    const sessions = recordingSessions();
    sessions.findBySessionId = (sessionId) =>
      Promise.resolve({
        sessionId,
        userId: 'acc_1',
        role: 'CUSTOMER',
        tokenHash: hashRefreshToken(token),
        familyId: 'fam_1',
        expiresAt: new Date(Date.now() + 60_000),
      });
    const refresh = new RefreshSessionUseCase(sessions, new TokenIssuer(sessions), accountsWith(undefined));

    expect(await codeOf(refresh.execute({ role: 'CUSTOMER', token }))).toBe('REFRESH_TOKEN_INVALID');
    expect(sessions.revokedUsers).toEqual(['acc_1']);
  });
});

// ─── Admin roster ───────────────────────────────────────────────────────────────────────────

function roster(entries: AdminRosterEntry[]): AdminRosterRepositoryPort & { rows: AdminRosterEntry[] } {
  const rows = entries.map((e) => ({ ...e }));
  return {
    rows,
    list: () => Promise.resolve(rows),
    findById: (id) => Promise.resolve(rows.find((r) => r.id === id)),
    findByPhone: (phone) => Promise.resolve(rows.find((r) => r.mobileNumber === phone)),
    create: (input) => {
      const row: AdminRosterEntry = {
        id: `adm_${rows.length + 1}`,
        mobileNumber: input.phone,
        fullName: input.fullName,
        adminRole: input.adminRole,
        isActive: true,
        createdAt: new Date(),
        deactivatedAt: null,
      };
      rows.push(row);
      return Promise.resolve(row);
    },
    changeGuarded: (id, change) => {
      const row = rows.find((r) => r.id === id);
      if (row === undefined) return Promise.resolve(undefined);
      if (change.adminRole !== undefined) row.adminRole = change.adminRole;
      if (change.isActive !== undefined) row.isActive = change.isActive;
      return Promise.resolve(row);
    },
  };
}

function admin(id: string, adminRole: AdminRole, isActive = true): AdminRosterEntry {
  return {
    id,
    mobileNumber: `+91900000${id.slice(-4).padStart(4, '0')}`,
    fullName: id,
    adminRole,
    isActive,
    createdAt: new Date(),
    deactivatedAt: null,
  };
}

describe('ManageAdminsUseCase', () => {
  const actor = { adminId: 'adm_1' };

  it('refuses a super admin changing their own role', async () => {
    const use = new ManageAdminsUseCase(roster([admin('adm_1', 'SUPER_ADMIN')]), recordingSessions(), recordingAudit());

    expect(await codeOf(use.update('adm_1', { adminRole: 'ADMIN' }, actor))).toBe('FORBIDDEN');
  });

  it('lets a super admin rename themselves', async () => {
    const use = new ManageAdminsUseCase(roster([admin('adm_1', 'SUPER_ADMIN')]), recordingSessions(), recordingAudit());

    expect((await use.update('adm_1', { fullName: 'New Name' }, actor)).id).toBe('adm_1');
  });

  it('refuses deactivating yourself', async () => {
    const use = new ManageAdminsUseCase(roster([admin('adm_1', 'SUPER_ADMIN')]), recordingSessions(), recordingAudit());

    expect(await codeOf(use.setActive('adm_1', false, actor))).toBe('FORBIDDEN');
  });

  it('signs a deactivated admin out everywhere and audits it', async () => {
    const sessions = recordingSessions();
    const audit = recordingAudit();
    const use = new ManageAdminsUseCase(
      roster([admin('adm_1', 'SUPER_ADMIN'), admin('adm_2', 'ADMIN')]),
      sessions,
      audit,
    );

    await use.setActive('adm_2', false, actor);

    expect(sessions.revokedUsers).toEqual(['adm_2']);
    expect(audit.entries.map((e) => e.action)).toEqual(['SUSPEND']);
  });

  it('refuses a number that already has an admin row, active or not', async () => {
    const existing = admin('adm_2', 'ADMIN', false);
    const use = new ManageAdminsUseCase(roster([admin('adm_1', 'SUPER_ADMIN'), existing]), recordingSessions(), recordingAudit());

    expect(
      await codeOf(use.create({ phone: existing.mobileNumber, fullName: 'X', adminRole: 'ADMIN' }, actor)),
    ).toBe('ADMIN_PHONE_TAKEN');
  });
});

describe('requireSuperAdmin', () => {
  function run(profileRole: AdminRole | undefined): Promise<unknown> {
    const admins: AdminProfileRepositoryPort = {
      findById: (id) =>
        Promise.resolve(
          profileRole === undefined
            ? undefined
            : { id, mobileNumber: '+919000000001', fullName: 'A', adminRole: profileRole },
        ),
      updateProfile: () => Promise.resolve(undefined),
    };
    const req = { principal: { sub: 'adm_1', role: 'ADMIN' } } as unknown as Request;
    return new Promise((resolve) => {
      makeRequireSuperAdmin(admins)(req, {} as Response, (err?: unknown) => resolve(err));
    });
  }

  it('lets a super admin through', async () => {
    expect(await run('SUPER_ADMIN')).toBeUndefined();
  });

  it('stops an ordinary admin', async () => {
    expect(((await run('ADMIN')) as AppError).code).toBe('FORBIDDEN');
  });

  it('stops a deactivated admin, whose profile lookup finds nothing', async () => {
    expect(((await run(undefined)) as AppError).code).toBe('FORBIDDEN');
  });
});

// ─── Deletion rules ─────────────────────────────────────────────────────────────────────────

describe('deletionBlockers', () => {
  it('returns every blocker at once, not the first', () => {
    const codes = deletionBlockers({ role: 'DRIVER', hasOpenBooking: true, isOnDuty: true, balancePaise: 500 }).map(
      (b) => b.code,
    );

    expect(codes).toEqual(['OPEN_BOOKING', 'ON_DUTY', 'UNSETTLED_BALANCE']);
  });

  it('lets a customer close with wallet credit, and reports what they give up', () => {
    const facts = { role: 'CUSTOMER' as const, hasOpenBooking: false, isOnDuty: false, balancePaise: 2500 };

    expect(deletionBlockers(facts)).toEqual([]);
    expect(forfeitedCreditPaise(facts)).toBe(2500);
  });

  it('stops a customer who owes money', () => {
    const facts = { role: 'CUSTOMER' as const, hasOpenBooking: false, isOnDuty: false, balancePaise: -100 };

    expect(deletionBlockers(facts).map((b) => b.code)).toEqual(['WALLET_DEBT']);
  });

  it('stops a driver owed money as well as one who owes it', () => {
    for (const balancePaise of [100, -100]) {
      const codes = deletionBlockers({ role: 'DRIVER', hasOpenBooking: false, isOnDuty: false, balancePaise }).map(
        (b) => b.code,
      );
      expect(codes).toEqual(['UNSETTLED_BALANCE']);
    }
  });
});

// ─── Deletion flow ──────────────────────────────────────────────────────────────────────────

function closure(account: ClosableAccount | undefined): AccountClosureContract & {
  calls: string[];
  closed: ClosedBy[];
} {
  const calls: string[] = [];
  const closed: ClosedBy[] = [];
  return {
    calls,
    closed,
    findClosable: () => Promise.resolve(account),
    sendClosureCode: () => {
      calls.push('send');
      return Promise.resolve({ expiresInSeconds: 300, retryAfterSeconds: 60 });
    },
    spendClosureCode: (_role, _phone, code) => {
      calls.push('spend');
      return code === '123456' ? Promise.resolve() : Promise.reject(Object.assign(new Error('x'), { code: 'OTP_INVALID_OR_EXPIRED' }));
    },
    close: (_role, _id, by) => {
      calls.push('close');
      closed.push(by);
      return Promise.resolve(true);
    },
  };
}

function deletion(identity: AccountClosureContract, openBooking: boolean): DeleteAccountUseCase {
  return new DeleteAccountUseCase(
    identity,
    { hasOpenBooking: () => Promise.resolve(openBooking) },
    { balance: () => Promise.resolve(0) },
    { walletBalance: () => Promise.resolve(0) },
  );
}

const CLOSABLE: ClosableAccount = { id: 'cus_1', mobileNumber: '+919000000003', isOnDuty: false };

describe('DeleteAccountUseCase', () => {
  it('in the app, refuses before sending a code when something blocks it', async () => {
    const identity = closure(CLOSABLE);

    expect(await codeOf(deletion(identity, true).requestCode('CUSTOMER', 'cus_1', undefined, undefined))).toBe(
      'ACCOUNT_DELETION_BLOCKED',
    );
    expect(identity.calls).toEqual([]);
  });

  it('in the app, spends the code and then closes', async () => {
    const identity = closure(CLOSABLE);

    await deletion(identity, false).confirm('CUSTOMER', 'cus_1', '123456');

    expect(identity.calls).toEqual(['spend', 'close']);
    expect(identity.closed).toEqual([{ type: 'SELF' }]);
  });

  /** Checking blockers first would tell an anonymous caller "this number has an open trip". */
  it('on the public form, proves the code BEFORE looking at blockers', async () => {
    const identity = closure(CLOSABLE);

    expect(await codeOf(deletion(identity, true).confirmByPhone('CUSTOMER', '+919000000003', '000000'))).toBe(
      'OTP_INVALID_OR_EXPIRED',
    );
    expect(identity.calls).toEqual(['spend']);
  });

  it('on the public form, still refuses a blocked account after a correct code', async () => {
    const identity = closure(CLOSABLE);

    expect(await codeOf(deletion(identity, true).confirmByPhone('CUSTOMER', '+919000000003', '123456'))).toBe(
      'ACCOUNT_DELETION_BLOCKED',
    );
    expect(identity.calls).toEqual(['spend']);
  });

  it('records the admin and the reason when an admin closes an account', async () => {
    const identity = closure(CLOSABLE);

    await deletion(identity, false).closeByAdmin('CUSTOMER', 'cus_1', { adminId: 'adm_1', reason: 'emailed request' });

    expect(identity.closed).toEqual([{ type: 'ADMIN', adminId: 'adm_1', ip: undefined, reason: 'emailed request' }]);
  });
});

describe('CloseAccountUseCase', () => {
  it('signs the person out everywhere and removes their files, private and public', async () => {
    const sessions = recordingSessions();
    const deleted: { key: string; isPrivate: boolean | undefined }[] = [];
    const use = new CloseAccountUseCase(
      {
        eraseCustomer: () => Promise.resolve(undefined),
        eraseDriver: () => Promise.resolve({ privateFileKeys: ['doc_1'], publicFileKeys: ['avatar_1'] }),
      },
      sessions,
      {
        deleteFile: (key, isPrivate) => {
          deleted.push({ key, isPrivate });
          return Promise.resolve();
        },
      },
      recordingAudit(),
    );

    expect(await use.execute('DRIVER', 'drv_1', { type: 'SELF' })).toBe(true);
    expect(sessions.revokedUsers).toEqual(['drv_1']);
    expect(deleted).toEqual([
      { key: 'doc_1', isPrivate: true },
      { key: 'avatar_1', isPrivate: false },
    ]);
  });

  it('does nothing further when there was nothing to erase', async () => {
    const sessions = recordingSessions();
    const use = new CloseAccountUseCase(
      { eraseCustomer: () => Promise.resolve(undefined), eraseDriver: () => Promise.resolve(undefined) },
      sessions,
      { deleteFile: () => Promise.resolve() },
      recordingAudit(),
    );

    expect(await use.execute('CUSTOMER', 'cus_1', { type: 'SELF' })).toBe(false);
    expect(sessions.revokedUsers).toEqual([]);
  });

  it('does not fail the deletion when storage does', async () => {
    const use = new CloseAccountUseCase(
      {
        eraseCustomer: () => Promise.resolve(undefined),
        eraseDriver: () => Promise.resolve({ privateFileKeys: ['doc_1'], publicFileKeys: [] }),
      },
      recordingSessions(),
      { deleteFile: () => Promise.reject(new Error('cloudinary down')) },
      recordingAudit(),
    );

    expect(await use.execute('DRIVER', 'drv_1', { type: 'SELF' })).toBe(true);
  });
});
