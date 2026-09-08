import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LatLng } from '@driverzone/geo';
import { AppError } from '../src/shared/errors/AppError.js';
import { GoogleRoadDistance } from '../src/modules/quotes/infrastructure/google.roadDistance.js';
import { CachingRoadDistance } from '../src/modules/quotes/infrastructure/caching.roadDistance.js';
import type { RoadDistancePort } from '../src/modules/quotes/domain/roadDistance.port.js';

/**
 * The two adapters that sit between a quote and the money it quotes.
 *
 * `GoogleRoadDistance` must send the request that stays in the cheap SKU, ceil to whole
 * kilometres exactly as OSRM did, return null for a genuine no-route, and turn a broken
 * provider into a fault rather than a wrong price. `CachingRoadDistance` must never call the
 * provider twice for the same route, and must fall through — never throw — when Redis misbehaves.
 */

const SILIGURI: LatLng = { lat: 26.7271, lng: 88.3953 };
const GANGTOK: LatLng = { lat: 27.3314, lng: 88.6138 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

const json = (payload: unknown, status = 200): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(payload), { status }));

describe('GoogleRoadDistance', () => {
  it('asks only for the distance field, drive mode, no traffic — the Essentials-SKU request', async () => {
    const fetchMock = stubFetch(() => json({ routes: [{ distanceMeters: 88_000 }] }));

    await new GoogleRoadDistance('key-123').roadDistanceKm(SILIGURI, GANGTOK);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('key-123');
    expect(headers['X-Goog-FieldMask']).toBe('routes.distanceMeters');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' });
    expect(body.origin.location.latLng).toEqual({ latitude: 26.7271, longitude: 88.3953 });
  });

  it('ceils metres up to the next whole kilometre so a trip cannot fall into the cheaper band', async () => {
    stubFetch(() => json({ routes: [{ distanceMeters: 70_200 }] }));
    const km = await new GoogleRoadDistance('k', 3000, 0).roadDistanceKm(SILIGURI, GANGTOK);
    expect(km).toBe(71);
  });

  it('returns null when Google reports no drivable route', async () => {
    stubFetch(() => json({})); // Compute Routes omits `routes` entirely for an unroutable pair.
    const km = await new GoogleRoadDistance('k', 3000, 0).roadDistanceKm(SILIGURI, GANGTOK);
    expect(km).toBeNull();
  });

  it('raises an internal fault when the provider errors, rather than returning a guess', async () => {
    stubFetch(() => json({ error: 'boom' }, 500));
    await expect(new GoogleRoadDistance('k', 3000, 0).roadDistanceKm(SILIGURI, GANGTOK)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('retries a 5xx exactly once, then succeeds', async () => {
    let calls = 0;
    const fetchMock = stubFetch(() => {
      calls += 1;
      return calls === 1 ? json({}, 503) : json({ routes: [{ distanceMeters: 42_000 }] });
    });

    const km = await new GoogleRoadDistance('k', 3000, 0).roadDistanceKm(SILIGURI, GANGTOK);

    expect(km).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx — a bad request twice is just double the quota spent', async () => {
    const fetchMock = stubFetch(() => json({ error: 'bad key' }, 403));
    await expect(new GoogleRoadDistance('k', 3000, 0).roadDistanceKm(SILIGURI, GANGTOK)).rejects.toBeInstanceOf(
      AppError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/** An in-memory stand-in for the two Redis commands the cache uses. */
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK' as const;
    }),
  };
}

const fixedInner = (km: number | null): RoadDistancePort => ({
  roadDistanceKm: vi.fn(async () => km),
});

describe('CachingRoadDistance', () => {
  it('calls the wrapped adapter once for a route, then serves the rest from cache', async () => {
    const redis = fakeRedis();
    const inner = fixedInner(88);
    const cache = new CachingRoadDistance(inner, redis);

    expect(await cache.roadDistanceKm(SILIGURI, GANGTOK)).toBe(88);
    expect(await cache.roadDistanceKm(SILIGURI, GANGTOK)).toBe(88);

    expect(inner.roadDistanceKm).toHaveBeenCalledTimes(1);
  });

  it('caches a no-route answer too, so an unroutable pair is not re-billed on every retry', async () => {
    const redis = fakeRedis();
    const inner = fixedInner(null);
    const cache = new CachingRoadDistance(inner, redis);

    expect(await cache.roadDistanceKm(SILIGURI, GANGTOK)).toBeNull();
    expect(await cache.roadDistanceKm(SILIGURI, GANGTOK)).toBeNull();

    expect(inner.roadDistanceKm).toHaveBeenCalledTimes(1);
  });

  it('keys on rounded coordinates — a metre of jitter is still a cache hit', async () => {
    const redis = fakeRedis();
    const inner = fixedInner(50);
    const cache = new CachingRoadDistance(inner, redis);

    await cache.roadDistanceKm(SILIGURI, GANGTOK);
    await cache.roadDistanceKm(
      { lat: SILIGURI.lat + 0.00002, lng: SILIGURI.lng - 0.00003 },
      GANGTOK,
    );

    expect(inner.roadDistanceKm).toHaveBeenCalledTimes(1);
  });

  it('falls through to the adapter when Redis reads fail — never throws', async () => {
    const redis = fakeRedis();
    redis.get.mockRejectedValue(new Error('redis down'));
    const inner = fixedInner(12);

    const km = await new CachingRoadDistance(inner, redis).roadDistanceKm(SILIGURI, GANGTOK);

    expect(km).toBe(12);
    expect(inner.roadDistanceKm).toHaveBeenCalledTimes(1);
  });
});
