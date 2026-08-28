import { describe, expect, it } from 'vitest';
import { parseZoneGeoJson, toGeoJsonExport } from './geojson-import';

/**
 * Import is the PRIMARY way a zone gets its shape, not an escape hatch, so these are the cases
 * that decide whether an admin can use a published boundary at all.
 *
 * Every fixture is a real shape of file: what OSM's export produces, what a GIS tool wraps
 * things in, what an administrative boundary looks like when it has an enclave.
 */

/** A square around Siliguri, wound CLOCKWISE — which is what map editors and exporters emit. */
const CLOCKWISE_RING = [
  [88.35, 26.65],
  [88.35, 26.78],
  [88.5, 26.78],
  [88.5, 26.65],
  [88.35, 26.65],
];

const polygon = (ring: number[][]) => ({ type: 'Polygon', coordinates: [ring] });

describe('parseZoneGeoJson', () => {
  it('unwraps a FeatureCollection, which is what an OSM export actually hands you', () => {
    const result = parseZoneGeoJson(
      JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: {}, geometry: polygon(CLOCKWISE_RING) }],
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.polygon.type).toBe('Polygon');
  });

  it('accepts a bare geometry and a lone Feature too', () => {
    expect(parseZoneGeoJson(JSON.stringify(polygon(CLOCKWISE_RING))).ok).toBe(true);
    expect(
      parseZoneGeoJson(
        JSON.stringify({ type: 'Feature', properties: {}, geometry: polygon(CLOCKWISE_RING) }),
      ).ok,
    ).toBe(true);
  });

  /**
   * ⚠ THE SILENT ONE. MongoDB's 2dsphere index reads a clockwise exterior ring as the whole
   * earth EXCEPT that shape, and it does not throw — the symptom is a hill zone that contains
   * every route in India and every plains trip overpaying (docs/LLD/zones.md §Four MongoDB
   * behaviours). Normalising on import is what keeps the browser's verdict identical to the
   * API's, since the API rewinds before it validates.
   */
  it('normalises a clockwise ring to counter-clockwise on the way in', () => {
    const result = parseZoneGeoJson(JSON.stringify(polygon(CLOCKWISE_RING)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ring = result.polygon.coordinates[0] ?? [];
    // The shoelace sum is positive for a counter-clockwise ring.
    const signedArea = ring.reduce((sum, point, index) => {
      const next = ring[(index + 1) % ring.length];
      if (next === undefined) return sum;
      return (
        sum +
        (point[0] as number) * (next[1] as number) -
        (next[0] as number) * (point[1] as number)
      );
    }, 0);

    expect(signedArea).toBeGreaterThan(0);
  });

  /**
   * An administrative boundary is a MultiPolygon far more often than you would expect — an
   * enclave, a digitising artefact one metre across. Refusing the whole import over a stray
   * part would send the admin back to hand-tracing, which is the thing this feature exists to
   * avoid. Largest wins, and the note says so.
   */
  it('takes the largest part of a MultiPolygon and says that it did', () => {
    const sliver = [
      [88.36, 26.66],
      [88.36, 26.661],
      [88.361, 26.661],
      [88.361, 26.66],
      [88.36, 26.66],
    ];

    const result = parseZoneGeoJson(
      JSON.stringify({
        type: 'MultiPolygon',
        coordinates: [[sliver], [CLOCKWISE_RING]],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toMatch(/largest/i);
    // The big square, not the sliver — compared on longitude span rather than identity, since
    // the ring came back rewound.
    const lngs = (result.polygon.coordinates[0] ?? []).map((point) => point[0] as number);
    expect(Math.max(...lngs) - Math.min(...lngs)).toBeCloseTo(0.15, 5);
  });

  it('refuses a point, a line, and an empty collection — none of them can be a zone', () => {
    for (const input of [
      { type: 'Point', coordinates: [88.4, 26.7] },
      {
        type: 'LineString',
        coordinates: [
          [88.4, 26.7],
          [88.5, 26.8],
        ],
      },
      { type: 'FeatureCollection', features: [] },
    ]) {
      expect(parseZoneGeoJson(JSON.stringify(input)).ok).toBe(false);
    }
  });

  it('refuses a ring with fewer than three distinct corners', () => {
    const result = parseZoneGeoJson(
      JSON.stringify(
        polygon([
          [88.4, 26.7],
          [88.5, 26.7],
          [88.4, 26.7],
        ]),
      ),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/three corners/i);
  });

  it('says what is wrong with invalid JSON rather than throwing', () => {
    const result = parseZoneGeoJson('{ "type": "Feature"');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/valid JSON/i);
  });

  it('treats an empty paste as a prompt, not a parse failure', () => {
    const result = parseZoneGeoJson('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/paste/i);
  });
});

describe('toGeoJsonExport', () => {
  it('round-trips back through the importer', () => {
    const exported = toGeoJsonExport('Siliguri', 'SLG', polygon(CLOCKWISE_RING) as never);
    const reimported = parseZoneGeoJson(exported);

    expect(reimported.ok).toBe(true);
    // No note: one polygon out, one polygon back.
    if (reimported.ok) expect(reimported.note).toBeUndefined();
  });
});
