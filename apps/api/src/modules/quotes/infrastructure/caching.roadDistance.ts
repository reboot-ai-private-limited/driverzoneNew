import type { LatLng } from '@driverzone/geo';
import { logger } from '../../../shared/logging/logger.js';
import { getRedis } from '../../../shared/queue/redis.js';
import type { RoadDistancePort } from '../domain/roadDistance.port.js';

/**
 * INFRASTRUCTURE — a read-through cache in front of any `RoadDistancePort`.
 *
 * A quote runs the router on every request, quote traffic is ~3× booking traffic, and the same
 * pickup and drop points recur relentlessly — they cluster at stands, stations and landmarks.
 * So most calls are for a route that was priced minutes ago. This turns the routing provider
 * from a per-quote cost into a per-distinct-route one (docs/LLD/packages.md §Route cache).
 *
 * KEYED ON ROUNDED COORDINATES — a ~110 m grid. Outstation bands are 25–30 km wide, so a 110 m
 * shift in either endpoint cannot move a trip across a band boundary except within ~100 m of
 * one, which is already inside the error of road-distance measurement. The design on file is an
 * H3 res-8 cell pair (~460 m); this is finer and needs no dependency.
 *
 * REDIS IS NOT A DEPENDENCY HERE. A miss, a timeout or an outage falls through to the wrapped
 * adapter — the cache can only ever make quoting cheaper, never break it.
 */

/** 30 days. A road network does not change on the timescale of a quote. */
const HIT_TTL_S = 30 * 24 * 60 * 60;
/** 1 day. A genuinely unroutable pair, remembered briefly so retries do not re-bill it. */
const MISS_TTL_S = 24 * 60 * 60;
/** Decimal places kept on each coordinate. 3 ≈ 110 m. */
const COORD_PRECISION = 3;
/** A cache lookup that outlives this budget is slower than just calling the router. */
const REDIS_TIMEOUT_MS = 200;

type RedisLike = Pick<ReturnType<typeof getRedis>, 'get' | 'set'>;

export class CachingRoadDistance implements RoadDistancePort {
  constructor(
    private readonly inner: RoadDistancePort,
    private readonly redis: RedisLike = getRedis(),
  ) {}

  async roadDistanceKm(from: LatLng, to: LatLng): Promise<number | null> {
    const key = cacheKey(from, to);

    const cached = await this.read(key);
    if (cached !== undefined) return cached;

    const fresh = await this.inner.roadDistanceKm(from, to);
    await this.write(key, fresh);
    return fresh;
  }

  async travelDurationMinutes(from: LatLng, to: LatLng): Promise<number | null> {
    const key = durationCacheKey(from, to);

    const cached = await this.read(key);
    if (cached !== undefined) return cached;

    const fresh = await this.inner.travelDurationMinutes(from, to);
    await this.write(key, fresh);
    return fresh;
  }

  /** `undefined` — not cached; `null` — cached "no route"; a number — cached distance or duration. */
  private async read(key: string): Promise<number | null | undefined> {
    try {
      const raw = await withTimeout(this.redis.get(key), REDIS_TIMEOUT_MS);
      if (raw === null) return undefined;
      if (raw === NO_ROUTE) return null;
      const num = Number(raw);
      return Number.isFinite(num) ? num : undefined;
    } catch (err) {
      logger.warn({ err, key }, 'road-distance cache read failed; computing fresh');
      return undefined;
    }
  }

  private async write(key: string, value: number | null): Promise<void> {
    const [payload, ttl] = value === null ? [NO_ROUTE, MISS_TTL_S] : [String(value), HIT_TTL_S];
    try {
      await withTimeout(this.redis.set(key, payload, 'EX', ttl), REDIS_TIMEOUT_MS);
    } catch (err) {
      logger.warn({ err, key }, 'road-distance cache write failed');
    }
  }
}

const NO_ROUTE = 'NO_ROUTE';

function cacheKey(from: LatLng, to: LatLng): string {
  return `roaddist:${round(from)}:${round(to)}`;
}

function durationCacheKey(from: LatLng, to: LatLng): string {
  return `routedur:${round(from)}:${round(to)}`;
}

function round(p: LatLng): string {
  return `${p.lat.toFixed(COORD_PRECISION)},${p.lng.toFixed(COORD_PRECISION)}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('redis timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
