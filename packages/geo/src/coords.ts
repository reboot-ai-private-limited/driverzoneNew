import type { Point, Position } from 'geojson';

/**
 * How the rest of the codebase talks about a location: `{ lat, lng }`, named, unordered.
 *
 * GeoJSON — and therefore MongoDB's 2dsphere index — uses `[longitude, latitude]`, which is
 * the reverse of how every human writes a coordinate and of what every maps UI hands you.
 * Swapping them does not throw: 26.72,88.39 (Siliguri) silently becomes 88.39,26.72, a point
 * in the Arabian Sea near Gujarat, which matches no zone and reports "we don't serve your
 * area" for a customer standing in the middle of a city you do serve.
 *
 * That failure is invisible in code review and expensive in production, so the conversion is
 * confined to `toPosition`/`fromPosition` and everything else uses the named form.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export class CoordinateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoordinateError';
  }
}

/**
 * Generous bounding box around India, including territorial waters and the islands.
 *
 * Not a service-area check — that is what zones are for. This is a tripwire for the swap
 * described above and for a `0,0` default that was never populated. Both are bugs; both would
 * otherwise present as a mysterious empty zone-resolution result.
 */
const INDIA_BOUNDS = { minLat: 6.0, maxLat: 37.6, minLng: 68.0, maxLng: 97.5 } as const;

export function isPlausibleIndianCoordinate(p: LatLng): boolean {
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= INDIA_BOUNDS.minLat &&
    p.lat <= INDIA_BOUNDS.maxLat &&
    p.lng >= INDIA_BOUNDS.minLng &&
    p.lng <= INDIA_BOUNDS.maxLng
  );
}

/**
 * Throws unless the point could plausibly be in India.
 *
 * Call this at the API boundary on every incoming coordinate. The error message names the
 * swap explicitly because that is what it almost always is — and because a caller who sees
 * "lat and lng may be swapped" fixes it in a minute, where "invalid coordinate" starts an
 * afternoon of debugging.
 */
export function assertPlausibleCoordinate(p: LatLng, label = 'coordinate'): void {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    throw new CoordinateError(`${label}: lat/lng must be finite numbers, got ${p.lat},${p.lng}`);
  }
  if (!isPlausibleIndianCoordinate(p)) {
    const swapped = isPlausibleIndianCoordinate({ lat: p.lng, lng: p.lat });
    throw new CoordinateError(
      `${label}: ${p.lat},${p.lng} is outside India` +
        (swapped ? ' — lat and lng appear to be swapped' : ''),
    );
  }
}

/** `{lat,lng}` → GeoJSON `[lng,lat]`. The ONE place the order flips. */
export function toPosition(p: LatLng): Position {
  return [p.lng, p.lat];
}

/** GeoJSON `[lng,lat]` → `{lat,lng}`. The one place it flips back. */
export function fromPosition(pos: Position): LatLng {
  const [lng, lat] = pos;
  if (lng === undefined || lat === undefined) {
    throw new CoordinateError(`position must have at least 2 elements, got ${pos.length}`);
  }
  return { lat, lng };
}

/** A GeoJSON Point ready for a Mongo `$geoIntersects` / `$geoNear` query. */
export function toGeoJsonPoint(p: LatLng): Point {
  return { type: 'Point', coordinates: toPosition(p) };
}
