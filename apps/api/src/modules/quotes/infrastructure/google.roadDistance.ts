import type { LatLng } from '@driverzone/geo';
import { AppError } from '../../../shared/errors/AppError.js';
import { logger } from '../../../shared/logging/logger.js';
import type { RoadDistancePort } from '../domain/roadDistance.port.js';

const ENDPOINT = 'https://routes.googleapis.com/directions/v2:computeRoutes';

/**
 * INFRASTRUCTURE — road distance from the Google Routes API (Compute Routes).
 *
 * Replaced self-hosted OSRM: the pilot VM could not spare the RAM for the India extract
 * (docs/decision-log.md). Cost is held down at three points and every one of them matters:
 *
 *   1. THE FIELD MASK is `routes.distanceMeters` and nothing else. Asking for a duration, a
 *      polyline or legs moves the call from the Essentials SKU ($5 / 1000, 10k/month free) to
 *      Pro ($10 / 1000, 5k free) — for numbers we would throw away, since terrain is decided at
 *      the drop point now, not measured along the route.
 *   2. `routingPreference` is TRAFFIC_UNAWARE. TRAFFIC_AWARE is a Pro SKU, and a fare band that
 *      shifted because of a traffic jam would be a support ticket, not a feature.
 *   3. `CachingRoadDistance` wraps this, and `CreateQuoteUseCase` never calls it for an in-city
 *      trip. Most quotes never reach this class.
 *
 * COORDINATES: `{lat, lng}` in, `{latitude, longitude}` out — Google wants them named and in
 * that order, so the lng/lat transposition that haunts the OSRM adapter cannot happen here.
 */
export class GoogleRoadDistance implements RoadDistancePort {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number = 3_000,
    private readonly retryDelayMs: number = 300,
  ) {}

  async roadDistanceKm(from: LatLng, to: LatLng): Promise<number | null> {
    const body = JSON.stringify({
      origin: waypoint(from),
      destination: waypoint(to),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      units: 'METRIC',
    });

    const response = await this.postWithOneRetry(body);
    const parsed = readRoute(await response.json());

    if (parsed === 'NO_ROUTE') return null;
    if (parsed === null) {
      throw AppError.internal('INTERNAL', {
        reason: 'Google Routes returned a response we cannot read',
      });
    }

    /*
     * CEILING TO WHOLE KILOMETRES, exactly as the OSRM adapter did — bands are half-open
     * `[minKm, maxKm)` over integers, so 70.2 km must land in 70–100 and not in 0–70.
     */
    return Math.ceil(parsed / 1000);
  }

  /**
   * Retries ONCE, and only for a transient failure — a 5xx or a dropped socket. A 4xx is a bug
   * in this request (bad key, malformed body); retrying it just spends the quota twice.
   */
  private async postWithOneRetry(body: string): Promise<Response> {
    try {
      return await this.post(body);
    } catch (error) {
      if (!isRetryable(error)) throw error;
      logger.warn({ err: error }, 'Google Routes request failed; retrying once');
      await delay(this.retryDelayMs);
      return this.post(body);
    }
  }

  private async post(body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          // The cost control — only the distance comes back, which is what keeps the call in
          // the Essentials SKU's price.
          'X-Goog-FieldMask': 'routes.distanceMeters',
        },
        body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw AppError.internal('INTERNAL', {
          reason: 'Google Routes request failed',
          status: response.status,
        });
      }
      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ err: error }, 'Google Routes unreachable');
      throw AppError.internal('INTERNAL', { reason: 'Could not reach the routing service' }, error);
    } finally {
      clearTimeout(timer);
    }
  }
}

function waypoint(p: LatLng): { location: { latLng: { latitude: number; longitude: number } } } {
  return { location: { latLng: { latitude: p.lat, longitude: p.lng } } };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A network error, or a 5xx — anything that a second attempt might get past. A 4xx is not. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  const status = (error.details as { status?: unknown } | undefined)?.status;
  return typeof status !== 'number' || status >= 500;
}

/** Metres, the string `'NO_ROUTE'`, or `null` when the body is not something we recognise. */
function readRoute(body: unknown): number | 'NO_ROUTE' | null {
  if (typeof body !== 'object' || body === null) return null;

  const routes = (body as { routes?: unknown }).routes;
  // Compute Routes omits `routes` entirely when there is no drivable path between the points —
  // the same meaning as OSRM's `code: 'NoRoute'`.
  if (routes === undefined) return 'NO_ROUTE';
  if (!Array.isArray(routes) || routes.length === 0) return 'NO_ROUTE';

  const distance = (routes[0] as { distanceMeters?: unknown }).distanceMeters;
  return typeof distance === 'number' && Number.isFinite(distance) ? distance : null;
}
