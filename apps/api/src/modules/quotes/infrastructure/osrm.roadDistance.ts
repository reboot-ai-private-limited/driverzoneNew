import type { LatLng } from '@driverzone/geo';
import { env } from '../../../config/env.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { logger } from '../../../shared/logging/logger.js';
import type { RoadDistancePort } from '../domain/roadDistance.port.js';

/**
 * INFRASTRUCTURE — road distance from a self-hosted OSRM.
 *
 * Self-hosted rather than a routing API, because this is called on every quote and a per-request
 * price on the pricing path is a variable cost on a fixed-price product. `OSRM_BASE_URL` has been
 * in `config/env.ts` since before anything called it; the service itself is commented out in
 * `docker-compose.dev.yml` and needs a region extract, which is why the haversine fallback beside
 * this file exists for local work.
 *
 * COORDINATES GO OUT AS `lng,lat`. OSRM, GeoJSON and PostGIS all order it that way while every
 * wire format in this repo uses `{lat, lng}`; getting it backwards puts Siliguri in the Indian
 * Ocean and returns no route rather than a wrong one, which is the one mercy of the mistake.
 */
export class OsrmRoadDistance implements RoadDistancePort {
  constructor(
    private readonly baseUrl: string = env.OSRM_BASE_URL,
    private readonly timeoutMs: number = 3_000,
  ) {}

  async roadDistanceKm(from: LatLng, to: LatLng): Promise<number | null> {
    const path = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    const url = `${this.baseUrl}/route/v1/driving/${path}?overview=false&alternatives=false`;

    const response = await this.fetchWithTimeout(url);
    const body: unknown = await response.json();

    const parsed = readOsrmRoute(body);

    if (parsed === 'NO_ROUTE') return null;
    if (parsed === null) {
      throw AppError.internal('INTERNAL', { reason: 'OSRM returned a response we cannot read', url });
    }

    /*
     * CEILING TO WHOLE KILOMETRES, and only here. Bands are half-open `[minKm, maxKm)` over
     * integers, so 70.2 km must land in 70–100 and not in 0–70. Rounding instead would put a
     * 70.2 km trip in the cheaper band and a 69.8 km trip in the dearer one.
     */
    return Math.ceil(parsed / 1000);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw AppError.internal('INTERNAL', {
          reason: 'OSRM request failed',
          status: response.status,
        });
      }
      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ err: error, url }, 'OSRM unreachable');
      throw AppError.internal('INTERNAL', { reason: 'Could not reach the routing service' }, error);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Metres, the string `'NO_ROUTE'`, or `null` when the body is not something we recognise. */
function readOsrmRoute(body: unknown): number | 'NO_ROUTE' | null {
  if (typeof body !== 'object' || body === null) return null;

  const raw = body as { code?: unknown; routes?: unknown };
  if (raw.code === 'NoRoute') return 'NO_ROUTE';
  if (raw.code !== 'Ok') return null;
  if (!Array.isArray(raw.routes) || raw.routes.length === 0) return 'NO_ROUTE';

  const distance = (raw.routes[0] as { distance?: unknown }).distance;
  return typeof distance === 'number' && Number.isFinite(distance) ? distance : null;
}
