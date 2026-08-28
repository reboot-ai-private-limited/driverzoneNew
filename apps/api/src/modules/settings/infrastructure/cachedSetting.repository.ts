import type { SettingOverride } from '../domain/setting.entity.js';
import type { SettingRepositoryPort, SettingWrite } from '../domain/setting.repository.port.js';

/**
 * INFRASTRUCTURE — a 60-second read cache, as docs/LLD/database-schema.md specifies for this
 * collection ("read through a cached accessor with a 60s TTL, not on every request").
 *
 * A decorator over the same port rather than a change to the Mongo repository, so the use cases
 * cannot tell the difference and a test can drop it entirely.
 *
 * ONE PROCESS ONLY. A write here clears this process's cache immediately; the worker is a
 * separate process and converges within the TTL instead. That lag is safe because a booking's
 * fare is snapshotted at confirmation (invariant B-1, docs/LLD/pricing-and-commission.md) — a
 * settings change mid-flight cannot alter a price a customer has already been shown. If a future
 * setting ever needs to take effect everywhere at once, this is the file that grows a pub/sub
 * invalidation, not the callers.
 */

const DEFAULT_TTL_MS = 60_000;

export class CachedSettingRepository implements SettingRepositoryPort {
  private cache: SettingOverride[] | undefined;
  private expiresAt = 0;

  constructor(
    private readonly inner: SettingRepositoryPort,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
    /** Injectable so the cache expiry test does not have to sleep for a minute. */
    private readonly now: () => number = Date.now,
  ) {}

  async findOverrides(): Promise<SettingOverride[]> {
    if (this.cache !== undefined && this.now() < this.expiresAt) return this.cache;

    const fresh = await this.inner.findOverrides();
    this.cache = fresh;
    this.expiresAt = this.now() + this.ttlMs;
    return fresh;
  }

  async putMany(writes: readonly SettingWrite[], updatedBy: string): Promise<SettingOverride[]> {
    const result = await this.inner.putMany(writes, updatedBy);
    this.invalidate();
    return result;
  }

  async deleteMany(keys: readonly string[]): Promise<SettingOverride[]> {
    const result = await this.inner.deleteMany(keys);
    this.invalidate();
    return result;
  }

  /** After a write, not before: a failed write must leave the cache describing what is still true. */
  invalidate(): void {
    this.cache = undefined;
    this.expiresAt = 0;
  }
}
