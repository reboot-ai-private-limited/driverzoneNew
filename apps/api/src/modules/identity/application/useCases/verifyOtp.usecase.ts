import type { Role } from '@driverzone/contracts';
import { judgeOtp } from '../../domain/otpChallenge.entity.js';
import { otpAttemptsExceeded, otpInvalidOrExpired } from '../../domain/identity.errors.js';
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
  ) {}

  async execute(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const { role, phone } = input;

    const challenge = await this.store.find(role, phone);

    /**
     * The attempt is counted BEFORE the code is judged, and atomically.
     *
     * Counting after a comparison — or computing `attempts + 1` from what `find` returned —
     * would let a burst of parallel guesses all read the same starting count and collectively
     * consume one attempt. The store increments and reports the new value; nothing here does
     * arithmetic on a stale read.
     */
    const attempts = await this.store.recordAttempt(role, phone);
    const verdict = judgeOtp(challenge, input.code, attempts ?? 0, this.pepper);

    if (verdict.outcome === 'ABSENT' || verdict.outcome === 'WRONG') {
      throw otpInvalidOrExpired();
    }

    if (verdict.outcome === 'EXHAUSTED') {
      // Burn it rather than leaving a spent challenge to expire: the next step is a new code, and
      // a challenge that lingers at max attempts is just a row that can only ever return errors.
      await this.store.burn(role, phone);
      throw otpAttemptsExceeded();
    }

    const existing = await this.accounts.findByPhone(role, phone);

    /**
     * Admin accounts are never created here (docs/LLD/13-auth-and-user.md §Admin) — an admin
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
