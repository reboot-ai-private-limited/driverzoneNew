import type { Role } from '@driverzone/contracts';
import { otpInvalidOrExpired } from '../../domain/identity.errors.js';
import { OtpChallengeVerifier } from '../otpChallengeVerifier.js';
import { AppError } from '@/shared/errors/AppError.js';
import type { Account, AccountRepositoryPort } from '../../domain/account.repository.port.js';
import type { OtpStorePort } from '../../domain/otpStore.port.js';
import type { TokenIssuer } from '../tokenIssuer.js';

export interface VerifyOtpInput {
  role: Role;
  phone: string;
  code: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface VerifyOtpResult {
  isNewUser: boolean;
  accessToken: string;
  refreshToken: string;
  account: Account;
}

/**
 * DEVELOPMENT ONLY — a fixed code accepted for a fixed list of seeded numbers.
 *
 * Deliberately an optional constructor argument rather than something read from `env` in here.
 * The use case has no way to switch itself on: it can only do this if a caller hands it the
 * config, and the only caller that does is `identity.container.ts`, which passes it exclusively
 * when `NODE_ENV` is not production. That makes "can this run in prod" a question about one line
 * in one file, and leaves every existing test on the real OTP path by default.
 */
export interface DevOtpBypass {
  code: string;
  /** Seeded numbers only. Any other number still gets a real, random, hashed challenge. */
  phones: readonly string[];
}

/**
 * APPLICATION — trade a correct code for a session.
 *
 * Two rules carry the weight here, and both are about what the caller is NOT told:
 *
 *   1. Wrong code, expired challenge, and no challenge at all are one error. Distinguishing them
 *      would let an attacker probe which numbers have ever requested a code.
 *   2. An unprovisioned admin number produces that same error. `sendOtp` already declined to
 *      store a challenge for it, so this falls out naturally — but the account lookup below is
 *      explicit anyway, because "it happens to work out" is not a security control.
 */
export class VerifyOtpUseCase {
  constructor(
    private readonly store: OtpStorePort,
    private readonly accounts: AccountRepositoryPort,
    private readonly tokens: TokenIssuer,
    private readonly pepper: string,
    /** Absent in production and in every test that does not deliberately opt in. */
    private readonly devBypass?: DevOtpBypass | undefined,
  ) {}

  /**
   * Whether this exact (number, code) pair is the development shortcut.
   *
   * Both halves must match: the code alone is not enough, and a seeded number alone is not
   * enough. A number that is not seeded takes the ordinary path even with the bypass configured.
   */
  private isDevBypass(phone: string, code: string): boolean {
    if (this.devBypass === undefined) return false;
    return this.devBypass.code === code && this.devBypass.phones.includes(phone);
  }

  async execute(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const { role, phone } = input;

    /**
     * The development shortcut, checked before anything is read or counted.
     *
     * It skips the challenge entirely — no `otp/send` needed first — because the friction it
     * exists to remove is exactly that round trip through a log line. It does NOT skip the
     * account rules below: an admin number that was never provisioned still fails, because that
     * check lives past this branch.
     */
    if (this.isDevBypass(phone, input.code)) {
      return this.completeSignIn(input);
    }

    /*
     * Counted atomically before judging, and an exhausted challenge is burned — see
     * `OtpChallengeVerifier`, which account deletion shares so the two cannot drift apart.
     */
    await new OtpChallengeVerifier(this.store, this.pepper).check(role, phone, input.code, 'LOGIN');

    return this.completeSignIn(input);
  }

  /**
   * Everything that happens once a code is accepted, however it was accepted.
   *
   * Shared with the development bypass on purpose: the account rules below — above all the
   * refusal to create an admin — must hold identically on both paths. A bypass that returned
   * early with its own token-issuing logic is exactly how a shortcut quietly acquires different
   * rules from the thing it is shortcutting.
   */
  private async completeSignIn(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const { role, phone } = input;

    const existing = await this.accounts.findByPhone(role, phone);

    if (existing?.isBlocked) {
      throw AppError.forbidden('Your account has been suspended.');
    }

    /**
     * Admin accounts are never created here (docs/LLD/auth.md §Admin provisioning) — an admin
     * number that reached a correct code without an existing record should be impossible, since
     * `sendOtp` stores no challenge for one. Treated as the generic failure regardless: if the
     * impossible happens, the safe outcome is "no", not "create an administrator".
     */
    if (existing === undefined && role === 'ADMIN') {
      await this.store.burn(role, phone);
      throw otpInvalidOrExpired();
    }

    const account = existing ?? (await this.accounts.create(role, phone));

    // Single-use: the code cannot be replayed even inside its 5-minute window.
    await this.store.burn(role, phone);

    const issued = await this.tokens.issueNewFamily(account.id, role, {
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      isNewUser: existing === undefined,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      account,
    };
  }
}
