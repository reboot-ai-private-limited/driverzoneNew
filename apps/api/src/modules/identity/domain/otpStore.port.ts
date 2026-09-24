import type { Role } from '@driverzone/contracts';
import type { OtpChallenge, OtpPurpose } from './otpChallenge.entity.js';

/**
 * PORT — where a live OTP challenge lives, and the counters that throttle it.
 *
 * Expressed without naming Redis, though Redis is what implements it. The shape is chosen around
 * one constraint the domain genuinely has: **attempt counting must be atomic**. Two guesses
 * arriving together must consume two attempts, not one — a read-then-write in the use case would
 * let a parallel flood share a single attempt budget and turn 5 tries into as many as the
 * attacker can pipeline.
 *
 * That is why `recordAttempt` returns the post-increment count rather than the use case
 * incrementing what `find` returned.
 *
 * Every challenge and cooldown method takes a trailing `purpose`, defaulting to `LOGIN`. The
 * hourly send counters deliberately do NOT: a phone gets one budget of texts per hour however many
 * flows are asking, or a second purpose would double what an attacker can make us send.
 */
export interface OtpStorePort {
  /** Replaces any existing challenge for this number and purpose, resetting attempts. */
  save(
    role: Role,
    phone: string,
    challenge: OtpChallenge,
    ttlSeconds: number,
    purpose?: OtpPurpose,
  ): Promise<void>;

  find(role: Role, phone: string, purpose?: OtpPurpose): Promise<OtpChallenge | undefined>;

  /**
   * Atomically increments the attempt counter and returns the NEW value.
   *
   * Returns `undefined` when no challenge exists — there is nothing to count against, and the
   * caller must not conjure one.
   */
  recordAttempt(role: Role, phone: string, purpose?: OtpPurpose): Promise<number | undefined>;

  /** Deletes the challenge. Called on success and on attempt exhaustion alike. */
  burn(role: Role, phone: string, purpose?: OtpPurpose): Promise<void>;

  /**
   * Seconds remaining on the resend cooldown, or 0 if a send is allowed right now.
   *
   * Read separately from `startCooldown` so the caller can report the remaining time in an error
   * body without having to guess it.
   */
  cooldownRemaining(role: Role, phone: string, purpose?: OtpPurpose): Promise<number>;

  startCooldown(role: Role, phone: string, seconds: number, purpose?: OtpPurpose): Promise<void>;

  /**
   * Atomically increments a rolling hourly counter and returns `{ count, ttlSeconds }`.
   *
   * `ttlSeconds` is how long until the window resets, which is exactly the `retry_after_seconds`
   * a rate-limited caller needs — computing it anywhere else would be guessing at the store's
   * own expiry.
   */
  countSend(scope: 'phone' | 'ip', key: string, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }>;
}
