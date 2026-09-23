import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * DOMAIN — what a login OTP IS, and the rules that govern one.
 *
 * No Redis, no Express, no logger. Everything here is a pure function over its arguments, which
 * is what lets the attempt/expiry rules be tested exhaustively with no I/O.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;

/**
 * Five wrong guesses burn the challenge.
 *
 * With a 6-digit code that is a 5-in-1,000,000 chance per challenge — and the send cooldown
 * caps how fast an attacker can buy fresh challenges, which is the limit that actually matters.
 */
export const OTP_MAX_ATTEMPTS = 5;

/** Seconds between sends to one number. Long enough to blunt SMS-pumping, short enough to resend. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Per-phone hourly cap — the figure fixed in docs/LLD/architecture.md. */
export const OTP_MAX_SENDS_PER_PHONE_PER_HOUR = 5;

/**
 * Per-IP hourly cap. Not in the original spec: the per-phone cap alone does nothing against one
 * source walking a range of numbers, which is what enumeration looks like.
 */
export const OTP_MAX_SENDS_PER_IP_PER_HOUR = 10;

/**
 * A 6-digit code, zero-padded so every code is the same length.
 *
 * `randomInt` and not `Math.random`: the latter is a PRNG seeded from process state, and its
 * output is predictable given enough samples. For a value that IS the credential, that is the
 * whole ballgame.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

/**
 * Keyed HMAC, not a password hash — see docs/decision-log.md, 2026-08-24.
 *
 * A 6-digit code has ~20 bits of entropy and lives 5 minutes; a memory-hard hash defends
 * against offline brute force of something the attempt limit already makes unbrute-forceable,
 * while costing latency on every legitimate retry. Non-invertible without the pepper is the
 * property that matters, and HMAC gives that for free.
 */
export function hashOtpCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

/**
 * Constant-time comparison of the two digests.
 *
 * `===` on strings short-circuits at the first differing byte, so response time leaks how much
 * of a guess was correct. Over enough requests that turns a 1-in-a-million guess into a
 * digit-by-digit walk.
 */
export function otpCodeMatches(candidate: string, storedHash: string, pepper: string): boolean {
  const candidateHash = hashOtpCode(candidate, pepper);
  const a = Buffer.from(candidateHash, 'hex');
  const b = Buffer.from(storedHash, 'hex');
  // timingSafeEqual throws on a length mismatch, which would itself be a timing signal — but
  // both sides are sha256 digests, so a mismatch here means a corrupt stored value, not input.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * What a code was sent FOR. A code is only ever good for its own purpose: a deletion code cannot
 * sign anybody in, and a login code cannot close an account. Each purpose also gets its own slot,
 * so starting one flow never overwrites the other's live code.
 */
export type OtpPurpose = 'LOGIN' | 'DELETE_ACCOUNT';

/** What the store holds against a phone number while a challenge is live. */
export interface OtpChallenge {
  codeHash: string;
  /** Wrong guesses so far. Incremented atomically by the adapter, never read-then-written. */
  attempts: number;
}

/**
 * The verdict on a presented code. A single type so the use case has one thing to branch on and
 * cannot forget a case.
 */
export type OtpVerdict =
  | { outcome: 'MATCHED' }
  /** Wrong code, and attempts remain. */
  | { outcome: 'WRONG' }
  /** Wrong code, and that was the last one — the challenge is spent. */
  | { outcome: 'EXHAUSTED' }
  /** No live challenge for this number at all: never sent, or already expired out of Redis. */
  | { outcome: 'ABSENT' };

/**
 * The rule, in one pure function.
 *
 * `attemptsAfterThisOne` is passed in rather than computed, because the increment must happen
 * atomically in the store — computing it here would be a read-then-write race that lets a
 * parallel flood of guesses share one attempt budget.
 */
export function judgeOtp(
  challenge: OtpChallenge | undefined,
  presentedCode: string,
  attemptsAfterThisOne: number,
  pepper: string,
): OtpVerdict {
  if (challenge === undefined) return { outcome: 'ABSENT' };
  if (otpCodeMatches(presentedCode, challenge.codeHash, pepper)) return { outcome: 'MATCHED' };
  return attemptsAfterThisOne >= OTP_MAX_ATTEMPTS ? { outcome: 'EXHAUSTED' } : { outcome: 'WRONG' };
}
