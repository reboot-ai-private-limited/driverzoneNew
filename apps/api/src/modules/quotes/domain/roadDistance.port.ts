import type { LatLng } from '@driverzone/geo';

/**
 * DOMAIN — measuring the road between two points.
 *
 * ROAD DISTANCE, NOT STRAIGHT LINE, and the difference decides money. Straight-line under-reports
 * by 30–50% in hill terrain, and with 25–30 km outstation bands that puts trips in the wrong band
 * constantly — a 98 km drive measured as 62 km sells at the 0–70 fare. `packages.public.ts` says
 * this in as many words on the field it feeds.
 */
export interface RoadDistancePort {
  /**
   * One-way road distance in kilometres, or `null` when no route exists between the points.
   *
   * `null` rather than a throw because "these two points are not connected by road" is an answer
   * the customer gets as a 200 with `available: false`, not a fault — an island, a closed border,
   * a pin dropped in a lake.
   */
  roadDistanceKm(from: LatLng, to: LatLng): Promise<number | null>;
}
