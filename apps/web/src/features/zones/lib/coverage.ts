import type { ZoneDto } from '@driverzone/contracts';
import { area } from '@turf/area';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { intersect } from '@turf/intersect';

/**
 * How much of the city has pickup coverage.
 *
 * `docs/LLD/admin-panel.md` §Live validation lists this as an INFO rule — "Only 18% of Siliguri
 * has pickup coverage" — and it is the single most useful number on the screen. Zone counts tell
 * an admin nothing: two pickup zones can cover the whole city or one neighbourhood, and the
 * difference is every `ZONE_NO_PICKUP_COVERAGE` a customer will ever see.
 *
 * SUMMING THE INTERSECTIONS IS CORRECT HERE, and only because of Z-2. Two active zones of the
 * same type may not overlap by more than 100 m², so the pickup areas are disjoint and their
 * areas add. Without that invariant this would need a union and would double-count every
 * overlap. If Z-2 is ever relaxed, this becomes wrong silently — which is why it is written
 * down here rather than assumed.
 */
export function pickupCoverageOfCity(city: ZoneDto | undefined, pickups: ZoneDto[]): number | null {
  if (city === undefined || pickups.length === 0) return null;

  try {
    const cityFeature = turfPolygon(city.geometry.coordinates);
    const cityArea = area(cityFeature);
    if (cityArea === 0) return null;

    const covered = pickups.reduce((total, zone) => {
      const shared = intersect(
        featureCollection([cityFeature, turfPolygon(zone.geometry.coordinates)]),
      );
      return total + (shared === null ? 0 : area(shared));
    }, 0);

    return Math.min(100, Math.round((covered / cityArea) * 100));
  } catch {
    // A malformed polygon somewhere in the set. The number is informational; a broken one is
    // worse than none, and the violation that caused it is already being reported elsewhere.
    return null;
  }
}
