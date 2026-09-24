import type { Redis } from 'ioredis';
import type { Role } from '@driverzone/contracts';
import type { OtpChallenge, OtpPurpose } from '../domain/otpChallenge.entity.js';
import type { OtpStorePort } from '../domain/otpStore.port.js';

/**
 * INFRASTRUCTURE — OTP challenges and their counters, in Redis.
 *
 * Redis rather than Mongo for all of it, and the reason is TTL. Every value here is
 * self-expiring — the challenge after 5 minutes, the cooldown after 60 seconds, the hourly
 * counters after an hour — and Redis expiry is the storage doing that for free. In Mongo each
 * would need an explicit expiry field plus a sweeper, for data that is worthless the moment it
 * ages out.
 *
 * The challenge is a HASH, not a JSON string, specifically so `HINCRBY` can burn an attempt
 * atomically. Serialised JSON would force read-modify-write, and a burst of parallel guesses
 * would then share one attempt budget — which is the exact failure the attempt cap exists to
 * prevent.
 */
export class RedisOtpStore implements OtpStorePort {
  constructor(private readonly redis: Redis) {}

  /**
   * Namespaced by role: the same number may legitimately be a customer AND a driver.
   *
   * And by purpose, except LOGIN, which keeps the original unprefixed key so that codes already
   * sent survive the deploy that introduced purposes.
   */
  private challengeKey(role: Role, phone: string, purpose: OtpPurpose): string {
    return purpose === 'LOGIN' ? `otp:${role}:${phone}` : `otp:${purpose}:${role}:${phone}`;
  }

  private cooldownKey(role: Role, phone: string, purpose: OtpPurpose): string {
    return purpose === 'LOGIN' ? `otp:cd:${role}:${phone}` : `otp:cd:${purpose}:${role}:${phone}`;
  }

  private sendCountKey(scope: 'phone' | 'ip', key: string): string {
    return `otp:sent:${scope}:${key}`;
  }

  async save(
    role: Role,
    phone: string,
    challenge: OtpChallenge,
    ttlSeconds: number,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<void> {
    const key = this.challengeKey(role, phone, purpose);
    await this.redis
      .multi()
      // `del` first: a resend must reset the attempt counter, and HSET alone would leave the
      // old count in place — letting an attacker refresh the code to buy 5 more guesses.
      .del(key)
      .hset(key, { codeHash: challenge.codeHash, attempts: String(challenge.attempts) })
      .expire(key, ttlSeconds)
      .exec();
  }

  async find(
    role: Role,
    phone: string,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<OtpChallenge | undefined> {
    const raw = await this.redis.hgetall(this.challengeKey(role, phone, purpose));
    const codeHash = raw['codeHash'];
    if (codeHash === undefined || codeHash === '') return undefined;
    return { codeHash, attempts: Number(raw['attempts'] ?? 0) };
  }

  /**
   * Atomic increment, returning the new count.
   *
   * `HINCRBY` on a missing key would CREATE it with value 1 — a challenge with an attempt count
   * and no code hash, which `find` would then report as absent while the key lingers. The
   * existence check makes a missing challenge return undefined instead, leaving nothing behind.
   */
  async recordAttempt(
    role: Role,
    phone: string,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<number | undefined> {
    const key = this.challengeKey(role, phone, purpose);
    const exists = await this.redis.exists(key);
    if (exists === 0) return undefined;
    return this.redis.hincrby(key, 'attempts', 1);
  }

  async burn(role: Role, phone: string, purpose: OtpPurpose = 'LOGIN'): Promise<void> {
    await this.redis.del(this.challengeKey(role, phone, purpose));
  }

  async cooldownRemaining(role: Role, phone: string, purpose: OtpPurpose = 'LOGIN'): Promise<number> {
    // -2 = no key, -1 = key with no expiry. Neither is a live cooldown.
    const ttl = await this.redis.ttl(this.cooldownKey(role, phone, purpose));
    return ttl > 0 ? ttl : 0;
  }

  async startCooldown(
    role: Role,
    phone: string,
    seconds: number,
    purpose: OtpPurpose = 'LOGIN',
  ): Promise<void> {
    await this.redis.set(this.cooldownKey(role, phone, purpose), '1', 'EX', seconds);
  }

  /**
   * A fixed window, not a sliding one.
   *
   * A sliding window is fairer at the boundary; it also needs a sorted set per key and a
   * trim on every call. For "5 texts an hour" the boundary case — a user getting up to 10 across
   * two adjacent windows — costs a few SMS and is not worth the complexity.
   */
  async countSend(
    scope: 'phone' | 'ip',
    key: string,
    windowSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    const redisKey = this.sendCountKey(scope, key);
    const count = await this.redis.incr(redisKey);

    // Only the first increment sets the expiry — resetting it on every call would extend the
    // window indefinitely for anyone who keeps hitting it, which never resets and is a lockout
    // rather than a rate limit.
    if (count === 1) await this.redis.expire(redisKey, windowSeconds);

    const ttl = await this.redis.ttl(redisKey);
    return { count, ttlSeconds: ttl > 0 ? ttl : windowSeconds };
  }
}
