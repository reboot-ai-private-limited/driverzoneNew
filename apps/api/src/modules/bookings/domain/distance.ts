/**
 * DOMAIN — how far apart two points are, in metres.
 *
 * Straight-line, and that is correct here even though it is wrong for pricing. This measures
 * "is the driver at the pickup point", which is a question about proximity, not about driving:
 * a driver standing 40 m away across a road divider is at the pickup, whatever the road network
 * says about the U-turn.
 *
 * NOT `@driverzone/geo`. That package has no distance function, and adding one would drag Turf
 * into a decision that is nine lines of trigonometry — `docs/engineering/mobile-in-monorepo.md`
 * already argues against widening that package for a coordinate helper.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface Point {
  lat: number;
  lng: number;
}

export function distanceMetres(a: Point, b: Point): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * A location fix older than this is not evidence of where somebody is now.
 *
 * Four minutes at highway speed is several kilometres, which is precisely how a driver "arrives"
 * without having arrived. The `arrived` call therefore carries a fresh fix rather than relying on
 * the last background ping.
 */
export const MAX_FIX_AGE_MS = 60_000;

export function isFixStale(fixTakenAt: Date, now: Date): boolean {
  return now.getTime() - fixTakenAt.getTime() > MAX_FIX_AGE_MS;
}
