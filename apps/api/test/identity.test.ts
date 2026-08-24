import { describe, expect, it } from 'vitest';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../src/shared/security/jwt.js';
import {
  OTP_MAX_ATTEMPTS,
  generateOtpCode,
  hashOtpCode,
  judgeOtp,
  otpCodeMatches,
} from '../src/modules/identity/domain/otpChallenge.entity.js';
import {
  REFRESH_REUSE_GRACE_MS,
  decideRefresh,
  hashRefreshToken,
} from '../src/modules/identity/domain/session.entity.js';
import { SendOtpUseCase } from '../src/modules/identity/application/useCases/sendOtp.usecase.js';
import { VerifyOtpUseCase } from '../src/modules/identity/application/useCases/verifyOtp.usecase.js';
import { TokenIssuer } from '../src/modules/identity/application/tokenIssuer.js';
import type { OtpChallenge } from '../src/modules/identity/domain/otpChallenge.entity.js';
import type { OtpStorePort } from '../src/modules/identity/domain/otpStore.port.js';
import type { OtpSenderPort } from '../src/modules/identity/domain/otpSender.port.js';
import type { Account, AccountRepositoryPort } from '../src/modules/identity/domain/account.repository.port.js';
import type { Session } from '../src/modules/identity/domain/session.entity.js';
import type { SessionRepositoryPort } from '../src/modules/identity/domain/session.repository.port.js';
import type { AppError } from '../src/shared/errors/AppError.js';

/**
 * The auth module's rules, exercised without Mongo, Redis or Express.
 *
 * Every port below is a plain object literal — the same trick the health module's tests use, and
 * the reason it works is that no use case is typed against a concrete adapter. That matters more
 * here than anywhere else in the codebase: these are the rules that decide who gets in, and a
 * test suite that needed a database is a test suite people skip.
 */

const PEPPER = 'test-pepper-value-that-is-long-enough';

// ─── Fakes ──────────────────────────────────────────────────────────────────────────────────

/** An in-memory OtpStore. `recordAttempt` increments for real, since atomicity is the rule. */
function fakeStore(seed: Partial<{ challenge: OtpChallenge; cooldown: number; sendCount: number }> = {}): OtpStorePort & {
  challenge: OtpChallenge | undefined;
  burned: boolean;
} {
  const state = {
    challenge: seed.challenge,
    burned: false,
    cooldown: seed.cooldown ?? 0,
    sendCount: seed.sendCount ?? 0,
  };
  return {
    get challenge() {
      return state.challenge;
    },
    get burned() {
      return state.burned;
    },
    save: (_r, _p, c) => {
      state.challenge = { ...c };
      return Promise.resolve();
    },
    find: () => Promise.resolve(state.challenge),
    recordAttempt: () => {
      if (state.challenge === undefined) return Promise.resolve(undefined);
      state.challenge.attempts += 1;
      return Promise.resolve(state.challenge.attempts);
    },
    burn: () => {
      state.burned = true;
      state.challenge = undefined;
      return Promise.resolve();
    },
    cooldownRemaining: () => Promise.resolve(state.cooldown),
    startCooldown: () => Promise.resolve(),
    countSend: () => {
      state.sendCount += 1;
      return Promise.resolve({ count: state.sendCount, ttlSeconds: 3600 });
    },
  };
}

function fakeSender(): OtpSenderPort & { sent: { phone: string; code: string }[] } {
  const sent: { phone: string; code: string }[] = [];
  return {
    sent,
    send: (_role, phone, code) => {
      sent.push({ phone, code });
      return Promise.resolve();
    },
  };
}

function fakeAccounts(existing?: Account): AccountRepositoryPort & { created: number } {
  const state = { created: 0 };
  return {
    get created() {
      return state.created;
    },
    findByPhone: () => Promise.resolve(existing),
    create: (_role, phone) => {
      state.created += 1;
      return Promise.resolve({ id: 'acc_new', mobileNumber: phone, fullName: null });
    },
  };
}

function fakeSessions(): SessionRepositoryPort {
  return {
    create: () => Promise.resolve(),
    findBySessionId: () => Promise.resolve(undefined),
    markUsed: () => Promise.resolve(true),
    revokeFamily: () => Promise.resolve(),
    revokeSession: () => Promise.resolve(),
  };
}

/** Narrow an unknown thrown value to the AppError shape these assertions care about. */
async function codeOfRejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'DID_NOT_THROW';
  } catch (err) {
    return (err as AppError).code;
  }
}

// ─── Tokens ─────────────────────────────────────────────────────────────────────────────────

describe('jwt', () => {
  it('round-trips the claims it was given', async () => {
    const token = await signAccessToken({ sub: 'user_1', role: 'CUSTOMER' });
    const claims = await verifyAccessToken(token, 'CUSTOMER');

    expect(claims).toMatchObject({ sub: 'user_1', role: 'CUSTOMER' });
  });

  /**
   * The audience check is the whole reason `aud` carries the role. Without this, a customer's
   * token would authenticate them on driver and admin routes alike.
   */
  it('rejects a customer token presented as a driver token', async () => {
    const token = await signAccessToken({ sub: 'user_1', role: 'CUSTOMER' });

    expect(await verifyAccessToken(token, 'DRIVER')).toBeUndefined();
  });

  /**
   * The two secrets are separate so a leak of one cannot forge the other. If this ever passes,
   * the secrets have been collapsed into one and a 15-minute exposure has become a 30-day one.
   */
  it('will not accept a refresh token as an access token', async () => {
    const refresh = await signRefreshToken({ sub: 'user_1', role: 'CUSTOMER', sid: 'ses_1' });

    expect(await verifyAccessToken(refresh, 'CUSTOMER')).toBeUndefined();
  });

  it('carries the session id on the refresh token, which is what makes rotation possible', async () => {
    const refresh = await signRefreshToken({ sub: 'user_1', role: 'ADMIN', sid: 'ses_42' });

    expect(await verifyRefreshToken(refresh, 'ADMIN')).toMatchObject({ sid: 'ses_42' });
  });

  it('rejects a tampered token rather than throwing', async () => {
    const token = await signAccessToken({ sub: 'user_1', role: 'CUSTOMER' });
    const tampered = `${token.slice(0, -3)}aaa`;

    expect(await verifyAccessToken(tampered, 'CUSTOMER')).toBeUndefined();
  });
});

// ─── OTP codes ──────────────────────────────────────────────────────────────────────────────

describe('otp codes', () => {
  it('generates six digits, zero-padded so every code is the same length', () => {
    // Many samples: a naive implementation only reveals the padding bug on the rare small number.
    for (let i = 0; i < 500; i += 1) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it('matches a correct code and rejects a wrong one', () => {
    const hash = hashOtpCode('123456', PEPPER);

    expect(otpCodeMatches('123456', hash, PEPPER)).toBe(true);
    expect(otpCodeMatches('123457', hash, PEPPER)).toBe(false);
  });

  /** The pepper is what makes a stolen Redis dump useless — a hash without it verifies nothing. */
  it('does not match when the pepper differs', () => {
    const hash = hashOtpCode('123456', PEPPER);

    expect(otpCodeMatches('123456', hash, 'a-different-pepper-entirely-here')).toBe(false);
  });
});

describe('judgeOtp', () => {
  const challenge = (): OtpChallenge => ({ codeHash: hashOtpCode('123456', PEPPER), attempts: 0 });

  it('matches the right code', () => {
    expect(judgeOtp(challenge(), '123456', 1, PEPPER)).toEqual({ outcome: 'MATCHED' });
  });

  it('is ABSENT when no challenge exists, which the caller must not distinguish from a wrong code', () => {
    expect(judgeOtp(undefined, '123456', 0, PEPPER)).toEqual({ outcome: 'ABSENT' });
  });

  it('is WRONG while attempts remain', () => {
    expect(judgeOtp(challenge(), '000000', 1, PEPPER)).toEqual({ outcome: 'WRONG' });
  });

  it('is EXHAUSTED on the attempt that reaches the cap, not the one after it', () => {
    expect(judgeOtp(challenge(), '000000', OTP_MAX_ATTEMPTS, PEPPER)).toEqual({ outcome: 'EXHAUSTED' });
  });
});

// ─── Session rotation ───────────────────────────────────────────────────────────────────────

describe('decideRefresh', () => {
  const base: Session = {
    sessionId: 'ses_1',
    userId: 'user_1',
    role: 'CUSTOMER',
    tokenHash: 'hash',
    familyId: 'fam_1',
  };

  it('rotates an unused token', () => {
    expect(decideRefresh(base, new Date())).toEqual({ action: 'ROTATE' });
  });

  it('rejects a token with no session behind it, and revokes nothing', () => {
    // Nothing to revoke: revoking on an unauthenticated signal would be a denial of service
    // anyone could trigger by posting a made-up session id.
    expect(decideRefresh(undefined, new Date())).toEqual({ action: 'REJECT' });
  });

  it('rejects a token whose family was already revoked', () => {
    const revoked = { ...base, usedAt: undefined, revokedAt: new Date() };

    expect(decideRefresh(revoked, new Date())).toEqual({ action: 'REJECT' });
  });

  /**
   * A mobile client on a weak signal genuinely double-submits: the first response is lost in
   * flight and the retry carries the same token. Killing the family there would sign a user out
   * for having bad reception.
   */
  it('treats a replay inside the grace window as the client double-submitting', () => {
    const now = new Date();
    const used = { ...base, usedAt: new Date(now.getTime() - (REFRESH_REUSE_GRACE_MS - 1_000)) };

    expect(decideRefresh(used, now)).toEqual({ action: 'REJECT_DOUBLE_SUBMIT' });
  });

  /**
   * THE theft signal. The legitimate client rotates away from a token the moment it spends one,
   * so a presentation this late means a second party holds it.
   */
  it('revokes the whole family for a replay past the grace window', () => {
    const now = new Date();
    const used = { ...base, usedAt: new Date(now.getTime() - (REFRESH_REUSE_GRACE_MS + 1_000)) };

    expect(decideRefresh(used, now)).toEqual({ action: 'REVOKE_FAMILY' });
  });
});

describe('hashRefreshToken', () => {
  it('is stable and does not return the token itself', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toContain('payload');
  });
});

// ─── Sending ────────────────────────────────────────────────────────────────────────────────

describe('SendOtpUseCase', () => {
  it('stores a challenge and hands the code to the sender', async () => {
    const store = fakeStore();
    const sender = fakeSender();
    const useCase = new SendOtpUseCase(store, sender, fakeAccounts(), PEPPER);

    await useCase.execute({ role: 'CUSTOMER', phone: '+919876543210' });

    expect(sender.sent).toHaveLength(1);
    // What is stored is the HMAC, never the code — a Redis dump must not hand anyone a login.
    expect(store.challenge?.codeHash).toBe(hashOtpCode(sender.sent[0]?.code ?? '', PEPPER));
  });

  it('refuses a resend inside the cooldown and says how long is left', async () => {
    const store = fakeStore({ cooldown: 41 });
    const useCase = new SendOtpUseCase(store, fakeSender(), fakeAccounts(), PEPPER);

    const err = await useCase
      .execute({ role: 'CUSTOMER', phone: '+919876543210' })
      .catch((e: unknown) => e as AppError);

    expect((err as AppError).code).toBe('OTP_COOLDOWN_ACTIVE');
    // The countdown is public detail: a client that cannot render it shows a dead wall instead.
    expect((err as AppError).publicDetails).toMatchObject({ retry_after_seconds: 41 });
  });

  it('stops sending once the hourly cap for a number is passed', async () => {
    const store = fakeStore({ sendCount: 5 });
    const useCase = new SendOtpUseCase(store, fakeSender(), fakeAccounts(), PEPPER);

    expect(await codeOfRejection(useCase.execute({ role: 'CUSTOMER', phone: '+919876543210' }))).toBe(
      'OTP_SEND_LIMIT_EXCEEDED',
    );
  });

  /**
   * The anti-enumeration property, and the one most easily broken by a well-meaning refactor.
   *
   * An unprovisioned admin number must produce the same 200 body as a real one. If this ever
   * fails, `/admin/auth/otp/send` has become a directory of who works here — walk a number
   * range, keep whatever does not error.
   */
  it('answers identically for an unprovisioned admin number, but sends nothing', async () => {
    const known = fakeStore();
    const knownSender = fakeSender();
    const provisioned = await new SendOtpUseCase(
      known,
      knownSender,
      fakeAccounts({ id: 'adm_1', mobileNumber: '+919000000001', fullName: 'Ops' }),
      PEPPER,
    ).execute({ role: 'ADMIN', phone: '+919000000001' });

    const unknown = fakeStore();
    const unknownSender = fakeSender();
    const unprovisioned = await new SendOtpUseCase(unknown, unknownSender, fakeAccounts(), PEPPER).execute({
      role: 'ADMIN',
      phone: '+919000000002',
    });

    expect(unprovisioned).toEqual(provisioned);
    expect(knownSender.sent).toHaveLength(1);
    // No SMS, and no challenge to verify against later.
    expect(unknownSender.sent).toHaveLength(0);
    expect(unknown.challenge).toBeUndefined();
  });
});

// ─── Verifying ──────────────────────────────────────────────────────────────────────────────

describe('VerifyOtpUseCase', () => {
  const liveChallenge = (): OtpChallenge => ({ codeHash: hashOtpCode('123456', PEPPER), attempts: 0 });

  function useCase(store: OtpStorePort, accounts: AccountRepositoryPort): VerifyOtpUseCase {
    return new VerifyOtpUseCase(store, accounts, new TokenIssuer(fakeSessions()), PEPPER);
  }

  it('creates the account on a first successful verify and flags it as new', async () => {
    const store = fakeStore({ challenge: liveChallenge() });
    const accounts = fakeAccounts();

    const result = await useCase(store, accounts).execute({
      role: 'CUSTOMER',
      phone: '+919876543210',
      code: '123456',
    });

    expect(result.isNewUser).toBe(true);
    expect(accounts.created).toBe(1);
    // Single-use: the code cannot be replayed even inside its five-minute window.
    expect(store.burned).toBe(true);
  });

  it('does not flag an existing account as new', async () => {
    const store = fakeStore({ challenge: liveChallenge() });
    const accounts = fakeAccounts({ id: 'cus_1', mobileNumber: '+919876543210', fullName: 'Anita' });

    const result = await useCase(store, accounts).execute({
      role: 'CUSTOMER',
      phone: '+919876543210',
      code: '123456',
    });

    expect(result.isNewUser).toBe(false);
    expect(accounts.created).toBe(0);
  });

  it('gives the same error for a wrong code as for no challenge at all', async () => {
    const wrongCode = await codeOfRejection(
      useCase(fakeStore({ challenge: liveChallenge() }), fakeAccounts()).execute({
        role: 'CUSTOMER',
        phone: '+919876543210',
        code: '000000',
      }),
    );

    const noChallenge = await codeOfRejection(
      useCase(fakeStore(), fakeAccounts()).execute({
        role: 'CUSTOMER',
        phone: '+919876543210',
        code: '123456',
      }),
    );

    // Telling these apart would reveal whether a number has ever requested a code.
    expect(wrongCode).toBe('OTP_INVALID_OR_EXPIRED');
    expect(noChallenge).toBe('OTP_INVALID_OR_EXPIRED');
  });

  it('burns the challenge once the attempt cap is reached', async () => {
    const store = fakeStore({ challenge: { codeHash: hashOtpCode('123456', PEPPER), attempts: OTP_MAX_ATTEMPTS - 1 } });

    const code = await codeOfRejection(
      useCase(store, fakeAccounts()).execute({ role: 'CUSTOMER', phone: '+919876543210', code: '000000' }),
    );

    expect(code).toBe('OTP_ATTEMPTS_EXCEEDED');
    // Burnt, not left to expire: the next step is a new code, not another guess.
    expect(store.burned).toBe(true);
  });

  /**
   * Admin accounts are provisioned out of band and never created by the auth flow. This is the
   * third independent guard on that rule — `sendOtp` stores no challenge for an unknown admin
   * number, and the repository refuses the write — because "creating an administrator" is not a
   * mistake worth leaving one refactor away from possible.
   */
  it('refuses to create an admin account even with a correct code', async () => {
    const store = fakeStore({ challenge: liveChallenge() });
    const accounts = fakeAccounts();

    const code = await codeOfRejection(
      useCase(store, accounts).execute({ role: 'ADMIN', phone: '+919000000002', code: '123456' }),
    );

    expect(code).toBe('OTP_INVALID_OR_EXPIRED');
    expect(accounts.created).toBe(0);
  });
});
