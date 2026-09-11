import type { LatLng } from '@driverzone/geo';
import { isProduction } from '../../../config/env.js';
import { logger } from '../../../shared/logging/logger.js';
import type { RoadDistancePort } from '../domain/roadDistance.port.js';

/**
 * INFRASTRUCTURE — a straight line with a fudge factor, for local work only.
 *
 * OSRM needs a region extract and several gigabytes of preprocessing, which is a great deal of
 * setup to ask of someone who wants to see a quote come back. This stands in.
 *
 * REFUSES TO RUN IN PRODUCTION, and it genuinely must. A detour factor is not a road network: it
 * is right on average and wrong on every individual trip, and every one of those errors is a
 * customer put in the wrong price band. The `packages` module's own documentation calls
 * straight-line measurement out by name as the thing that must not decide a band.
 */

const EARTH_RADIUS_M = 6_371_000;

/**
 * Straight-line distances multiplied by this to approximate a road.
 *
 * 1.3 is the usual figure for Indian plains. It is meaningfully worse in hills — the terrain where
 * bands are narrowest and the error matters most — which is the second reason this is not a
 * production adapter.
 */
const DETOUR_FACTOR = 1.3;

export class HaversineRoadDistance implements RoadDistancePort {
  constructor() {
    if (isProduction) {
      throw new Error(
        'HaversineRoadDistance must never run in production — it puts trips in the wrong price band',
      );
    }
    logger.warn(
      'Road distance is being approximated from straight-line distance. Fares will be wrong. Start OSRM for real distances.',
    );
  }

  async roadDistanceKm(from: LatLng, to: LatLng): Promise<number> {
    const metres = haversineMetres(from, to) * DETOUR_FACTOR;
    // Ceiling to match the OSRM adapter exactly — bands are half-open over whole kilometres.
    return Math.ceil(metres / 1000);
  }

  async travelDurationMinutes(from: LatLng, to: LatLng): Promise<number> {
    const km = await this.roadDistanceKm(from, to);
    // Dev-only fallback: approximate driving duration assuming 45 km/h average speed
    return Math.ceil((km / 45) * 60);
  }
}

function haversineMetres(from: LatLng, to: LatLng): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
