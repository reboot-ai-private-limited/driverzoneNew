import { normalizeWinding, type Polygon } from '@driverzone/geo';

/**
 * Between Google's polygon paths and GeoJSON. Two conventions differ, and BOTH of them differ
 * silently — a mistake here produces a polygon that is a valid polygon, somewhere else entirely.
 *
 *   ORDER   Google says `{lat, lng}`. GeoJSON says `[lng, lat]` — longitude FIRST.
 *   CLOSURE Google's path is open: four corners is four points. A GeoJSON ring is closed: four
 *           corners is five points, the last repeating the first.
 *
 * The order one is the reason `docs/LLD/zones.md` gives a swapped coordinate its own fault code
 * (`INVALID_COORDINATE`, "nearly always a lat/lng swap") and its own ⚠ row in the edge-case
 * table. Siliguri is 26.7 N, 88.4 E; transposed it is 88.4 N, 26.7 E, which is in the Arctic
 * Ocean — far enough away to be obvious the moment anyone looks at a map, and completely
 * invisible to every geometric check, all of which would happily validate the wrong shape.
 *
 * That is what `google-geometry.test.ts` is for.
 */

/**
 * A Google `LatLng`, structurally.
 *
 * Typed by shape rather than as `google.maps.LatLng` so this module has no dependency on the
 * Maps API being loaded — which is what lets it be tested in the DOM-free node environment
 * `apps/web/vitest.config.ts` sets up.
 */
export interface LatLngLike {
  lat: () => number;
  lng: () => number;
}

export interface PathLike {
  getArray: () => LatLngLike[];
}

/**
 * Google path → GeoJSON Polygon.
 *
 * Winding is normalised on the way out, exactly as `geojson-import.ts` does on the way in. Google
 * hands back whatever order the vertices were dragged into, and a clockwise exterior ring is read
 * by MongoDB's 2dsphere index as the whole earth EXCEPT that shape — with no error anywhere
 * (docs/LLD/zones.md §Four MongoDB behaviours). Normalising here is what keeps the browser's
 * live verdict identical to the one the API computes after it rewinds.
 *
 * Returns null below three corners: that is a polygon still being drawn, not a broken one, and
 * `useZoneValidation` renders "click on the map to place the first corner" for it rather than a
 * violation.
 */
export function pathToPolygon(path: PathLike): Polygon | null {
  const points = path.getArray();
  if (points.length < 3) return null;

  const ring = points.map((point) => [point.lng(), point.lat()] as [number, number]);

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first === undefined || last === undefined) return null;

  // Close it. Google's path never repeats the first point; a GeoJSON ring must. The guard is for
  // the case where a user drags the last vertex exactly onto the first, which would otherwise
  // produce a duplicate-and-then-duplicated ring.
  const closed =
    first[0] === last[0] && first[1] === last[1] ? [...ring] : [...ring, [first[0], first[1]]];

  return normalizeWinding({ type: 'Polygon', coordinates: [closed as number[][]] });
}

/**
 * GeoJSON Polygon → the literal Google needs to build a path.
 *
 * The closing coordinate is DROPPED. Passing a closed ring to Google produces a polygon with two
 * coincident vertices stacked at the same point — it renders identically, and then the admin
 * drags one of them and the shape tears in a way that looks like a rendering bug.
 *
 * Interior rings are ignored: a zone is a single ring by schema, and `geojson-import.ts` already
 * refuses anything that is not.
 */
export function polygonToPath(polygon: Polygon): { lat: number; lng: number }[] {
  const ring = polygon.coordinates[0] ?? [];
  if (ring.length === 0) return [];

  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed =
    first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];

  return (isClosed ? ring.slice(0, -1) : ring).map((position) => ({
    lat: position[1] as number,
    lng: position[0] as number,
  }));
}

/** Turf's `[west, south, east, north]` → the corner pair `LatLngBounds` is built from. */
export function bboxToBounds(box: number[]): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const [west, south, east, north] = box;
  return {
    west: west as number,
    south: south as number,
    east: east as number,
    north: north as number,
  };
}
