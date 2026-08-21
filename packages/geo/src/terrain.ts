import { booleanPointInPolygon } from '@turf/boolean-point-in-polygon';
import { lineString, point, polygon as turfPolygon } from '@turf/helpers';
import { length } from '@turf/length';
import { lineSplit } from '@turf/line-split';
import type { LineString, Polygon, Position } from 'geojson';

/**
 * Terrain classification for outstation pricing — the replacement for
 * `ST_Length(ST_Intersection(route, hill_zone))`.
 *
 * Classified on the ROUTE, never on the destination point. Siliguri to a plains town reached
 * only by crossing a hill stretch is a hill trip for the driver: the destination is flat, the
 * work is not, and pricing it as plains underpays them for the hardest part of the job.
 */

/** Midpoint of the segment's two most central coordinates. */
function representativePoint(coords: Position[]): Position | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) return coords[0] ?? null;

  const i = Math.floor(coords.length / 2);
  const a = coords[i - 1];
  const b = coords[i];
  if (!a || !b) return null;

  // A true midpoint, not a vertex. A vertex of a split segment sits exactly ON the polygon
  // boundary, where point-in-polygon is a coin flip.
  const [ax, ay] = a;
  const [bx, by] = b;
  if (ax === undefined || ay === undefined || bx === undefined || by === undefined) return null;
  return [(ax + bx) / 2, (ay + by) / 2];
}

/**
 * Metres of `route` falling inside `hillZones`.
 *
 * Splits the route on each polygon's boundary, then keeps the pieces whose midpoint is inside.
 * Zones are processed independently and summed, which is safe because invariant Z-2 forbids
 * two active zones of the same type from overlapping — no stretch is counted twice.
 */
export function hillMetresOnRoute(route: LineString, hillZones: Polygon[]): number {
  if (hillZones.length === 0) return 0;

  const routeFeature = lineString(route.coordinates);
  let metres = 0;

  for (const zone of hillZones) {
    const zf = turfPolygon(zone.coordinates);

    let pieces;
    try {
      pieces = lineSplit(routeFeature, zf).features;
    } catch {
      // lineSplit throws on degenerate input. A route we cannot split is one we cannot
      // classify, and silently returning PLAIN would underpay the driver — so skip this zone
      // and let the caller's threshold decide on whatever the other zones contributed.
      continue;
    }

    // No intersection with the boundary: the route is either wholly inside or wholly outside.
    if (pieces.length === 0) {
      const rep = representativePoint(route.coordinates);
      if (rep && booleanPointInPolygon(point(rep), zf)) {
        metres += length(routeFeature, { units: 'meters' });
      }
      continue;
    }

    for (const piece of pieces) {
      const rep = representativePoint(piece.geometry.coordinates);
      if (rep && booleanPointInPolygon(point(rep), zf)) {
        metres += length(piece, { units: 'meters' });
      }
    }
  }

  return Math.round(metres);
}

export type Terrain = 'PLAIN' | 'HILL';

/**
 * `HILL` once the route spends `thresholdMetres` inside hill terrain.
 *
 * The threshold exists because a route clipping the corner of a hill zone for 800 m is not a
 * hill trip, while one that spends 30 km climbing plainly is. Default 5 km, and it lives in
 * global settings (`outstation.hill_route_threshold_m`) because it is a guess until there is
 * real data — the signal to tune it is drivers reporting specific routes as underpaid.
 */
export function classifyTerrain(
  route: LineString,
  hillZones: Polygon[],
  thresholdMetres: number,
): { terrain: Terrain; hillMetres: number } {
  const hillMetres = hillMetresOnRoute(route, hillZones);
  return { terrain: hillMetres >= thresholdMetres ? 'HILL' : 'PLAIN', hillMetres };
}
