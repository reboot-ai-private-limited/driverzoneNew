import type { Role } from '@driverzone/contracts';
import { judgeOtp, type OtpPurpose } from '../domain/otpChallenge.entity.js';
import { otpAttemptsExceeded, otpInvalidOrExpired } from '../domain/identity.errors.js';
import type { OtpStorePort } from '../domain/otpStore.port.js';

/**
 * APPLICATION — spend one guess against a live challenge, and say whether it was right.
 *
 * Shared by login and account deletion so the two cannot drift apart on the rules that matter:
 * the attempt is counted BEFORE the code is judged and atomically, a wrong or missing code is one
 * indistinguishable error, and an exhausted challenge is burned rather than left to expire.
 *
 * It does NOT burn a matched challenge. The caller does that once it has finished acting on it,
 * so a login that fails after the code was accepted (a suspended account, say) is still judged by
 * the same rules as before this was extracted.
 */
export class OtpChallengeVerifier {
  constructor(
    private readonly store: OtpStorePort,
    private readonly pepper: string,
  ) {}

  /** Resolves on a correct code; throws the generic OTP error otherwise. */
  async check(role: Role, phone: string, code: string, purpose: OtpPurpose): Promise<void> {
    const challenge = await this.store.find(role, phone, purpose);

    /*
     * Counted before judging, and by the store. Computing `attempts + 1` from what `find` returned
     * would let a burst of parallel guesses all read the same count and share one attempt.
     */
    const attempts = await this.store.recordAttempt(role, phone, purpose);
    const verdict = judgeOtp(challenge, code, attempts ?? 0, this.pepper);

    if (verdict.outcome === 'ABSENT' || verdict.outcome === 'WRONG') {
      throw otpInvalidOrExpired();
    }

    if (verdict.outcome === 'EXHAUSTED') {
      await this.store.burn(role, phone, purpose);
      throw otpAttemptsExceeded();
    }
  }
}
