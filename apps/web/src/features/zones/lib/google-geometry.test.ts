import { describe, expect, it } from 'vitest';
import { bboxToBounds, pathToPolygon, polygonToPath, type PathLike } from './google-geometry';

/**
 * The lat/lng boundary, tested from both sides.
 *
 * `docs/LLD/zones.md` treats a transposed coordinate as a named failure with its own fault code,
 * because it is invisible to every geometric check — a swapped Siliguri is a perfectly valid
 * polygon in the Arctic Ocean. This file is the only thing standing between that and production.
 */

/** Siliguri, roughly: 26.7 N, 88.4 E. Deliberately asymmetric so a swap cannot pass unnoticed. */
const CORNERS = [
  { lat: 26.65, lng: 88.35 },
  { lat: 26.78, lng: 88.35 },
  { lat: 26.78, lng: 88.5 },
  { lat: 26.65, lng: 88.5 },
];

/** Google's path, structurally — accessor methods, not properties. */
const pathOf = (corners: { lat: number; lng: number }[]): PathLike => ({
  getArray: () => corners.map((c) => ({ lat: () => c.lat, lng: () => c.lng })),
});

describe('pathToPolygon', () => {
  it('emits [lng, lat], not [lat, lng]', () => {
    const polygon = pathToPolygon(pathOf(CORNERS));
    expect(polygon).not.toBeNull();

    for (const position of polygon?.coordinates[0] ?? []) {
      // Longitude first. Siliguri's longitude is ~88 and its latitude ~26, so the two are
      // unambiguous — a transposition puts an 88 where a 26 belongs and this fails loudly.
      expect(position[0]).toBeGreaterThan(80);
      expect(position[1]).toBeLessThan(30);
    }
  });

  it('closes the ring — Google leaves it open, GeoJSON requires it shut', () => {
    const polygon = pathToPolygon(pathOf(CORNERS));
    const ring = polygon?.coordinates[0] ?? [];

    expect(ring).toHaveLength(CORNERS.length + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('does not double-close a path whose last vertex already repeats the first', () => {
    const polygon = pathToPolygon(pathOf([...CORNERS, CORNERS[0] as { lat: number; lng: number }]));
    const ring = polygon?.coordinates[0] ?? [];

    expect(ring).toHaveLength(CORNERS.length + 1);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  /**
   * ⚠ The silent one. A clockwise exterior ring is read by MongoDB's 2dsphere index as the whole
   * earth except that shape, and nothing throws. Google returns whatever order the vertices were
   * dragged into, so normalising here is not defensive — it is the common case.
   */
  it('normalises winding, whichever direction the vertices were dragged in', () => {
    const counterClockwise = pathToPolygon(pathOf(CORNERS));
    const clockwise = pathToPolygon(pathOf([...CORNERS].reverse()));

    for (const polygon of [counterClockwise, clockwise]) {
      const ring = polygon?.coordinates[0] ?? [];
      const signedArea = ring.reduce((sum, position, index) => {
        const next = ring[(index + 1) % ring.length];
        if (next === undefined) return sum;
        return (
          sum +
          (position[0] as number) * (next[1] as number) -
          (next[0] as number) * (position[1] as number)
        );
      }, 0);
      // Positive shoelace sum = counter-clockwise, which is what RFC 7946 and the index want.
      expect(signedArea).toBeGreaterThan(0);
    }
  });

  it('returns null below three corners — a polygon mid-draw, not a broken one', () => {
    expect(pathToPolygon(pathOf([]))).toBeNull();
    expect(pathToPolygon(pathOf(CORNERS.slice(0, 1)))).toBeNull();
    expect(pathToPolygon(pathOf(CORNERS.slice(0, 2)))).toBeNull();
  });
});

describe('polygonToPath', () => {
  it('drops the closing coordinate, so no two vertices sit on top of each other', () => {
    const polygon = pathToPolygon(pathOf(CORNERS));
    expect(polygon).not.toBeNull();
    if (polygon === null) return;

    const path = polygonToPath(polygon);

    expect(path).toHaveLength(CORNERS.length);
    expect(path[0]).not.toEqual(path[path.length - 1]);
  });

  it('puts latitude back on lat and longitude back on lng', () => {
    const polygon = pathToPolygon(pathOf(CORNERS));
    if (polygon === null) throw new Error('fixture failed to convert');

    for (const point of polygonToPath(polygon)) {
      expect(point.lat).toBeGreaterThan(26);
      expect(point.lat).toBeLessThan(27);
      expect(point.lng).toBeGreaterThan(88);
      expect(point.lng).toBeLessThan(89);
    }
  });

  it('round-trips: path → GeoJSON → path is the same set of corners', () => {
    const polygon = pathToPolygon(pathOf(CORNERS));
    if (polygon === null) throw new Error('fixture failed to convert');

    const path = polygonToPath(polygon);

    // Winding normalisation may reverse the order, so compare as sets rather than sequences.
    const key = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;
    expect(new Set(path.map(key))).toEqual(new Set(CORNERS.map(key)));
  });

  it('tolerates an already-open ring', () => {
    const open = { type: 'Polygon' as const, coordinates: [CORNERS.map((c) => [c.lng, c.lat])] };
    expect(polygonToPath(open)).toHaveLength(CORNERS.length);
  });
});

describe('bboxToBounds', () => {
  it('maps turf’s [west, south, east, north] onto the right corners', () => {
    expect(bboxToBounds([88.35, 26.65, 88.5, 26.78])).toEqual({
      west: 88.35,
      south: 26.65,
      east: 88.5,
      north: 26.78,
    });
  });
});
