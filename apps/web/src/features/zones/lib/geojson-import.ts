import { normalizeWinding, type Polygon } from '@driverzone/geo';
import { area } from '@turf/area';
import { polygon as turfPolygon } from '@turf/helpers';

/**
 * Turn pasted GeoJSON into one Polygon, or say why it cannot.
 *
 * THIS IS THE PRIMARY WAY A ZONE SHOULD GET ITS SHAPE, not an escape hatch. Siliguri Municipal
 * Corporation, the Darjeeling and Kalimpong subdivisions — these are published boundaries and
 * they exist as OSM relations you can export in about a minute. A hand-traced approximation of
 * a boundary that already exists is slower AND less accurate, on any basemap, and it is how a
 * zone edge ends up in the wrong place with nobody able to say by how much.
 *
 * Hand-drawing stays for the case that genuinely has no published shape: a pickup zone, which
 * is a commercial decision about where drivers wait rather than a line on a survey.
 *
 * Winding is normalised HERE as well as in the API's write path. Not defensive duplication —
 * the local validation in `useZoneValidation` runs against whatever comes out of this function,
 * and a clockwise ring makes Turf's predicates disagree with the ones the server will run after
 * IT rewinds. Normalising on the way in is what keeps the two verdicts identical.
 */

export type ImportResult =
  { ok: true; polygon: Polygon; note?: string } | { ok: false; message: string };

function fail(message: string): ImportResult {
  return { ok: false, message };
}

/** The rings of every Polygon reachable from a parsed GeoJSON value, however it was wrapped. */
function collectPolygons(node: unknown): Polygon[] {
  if (node === null || typeof node !== 'object') return [];
  const value = node as Record<string, unknown>;

  switch (value['type']) {
    case 'FeatureCollection':
      return Array.isArray(value['features']) ? value['features'].flatMap(collectPolygons) : [];
    case 'Feature':
      return collectPolygons(value['geometry']);
    case 'GeometryCollection':
      return Array.isArray(value['geometries']) ? value['geometries'].flatMap(collectPolygons) : [];
    case 'Polygon':
      return Array.isArray(value['coordinates']) ? [value as unknown as Polygon] : [];
    /**
     * A MultiPolygon is split into its parts and the largest is taken, with a note. An
     * administrative boundary is a MultiPolygon far more often than you would expect — an
     * enclave, an offshore sliver, a digitising artefact one metre across — and refusing the
     * whole import over a stray part would send the admin back to hand-tracing for no reason.
     * A zone is ONE polygon by schema, so something has to be chosen; choosing the largest and
     * saying so is the honest version.
     */
    case 'MultiPolygon':
      return Array.isArray(value['coordinates'])
        ? (value['coordinates'] as unknown[]).map((coordinates) => ({
            type: 'Polygon' as const,
            coordinates: coordinates as Polygon['coordinates'],
          }))
        : [];
    default:
      return [];
  }
}

/** Turf throws on a ring too short or unclosed, so area is only asked for once it is safe. */
function safeArea(polygon: Polygon): number {
  const outer = polygon.coordinates[0];
  if (outer === undefined || outer.length < 4) return 0;
  try {
    return area(turfPolygon(polygon.coordinates));
  } catch {
    return 0;
  }
}

export function parseZoneGeoJson(text: string): ImportResult {
  const trimmed = text.trim();
  if (trimmed === '') return fail('Paste some GeoJSON first.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return fail('That is not valid JSON. Paste the whole file, including the outer braces.');
  }

  const polygons = collectPolygons(parsed);

  if (polygons.length === 0) {
    return fail(
      'No polygon in there. A zone needs a Polygon or MultiPolygon — a point or a line cannot be a zone.',
    );
  }

  // Sorted rather than picked in document order: "the first one" is an arbitrary rule that
  // depends on how the exporter happened to serialise the file.
  const [largest, ...rest] = [...polygons].sort((a, b) => safeArea(b) - safeArea(a));
  if (largest === undefined) return fail('No polygon in there.');

  const outer = largest.coordinates[0];
  if (outer === undefined || outer.length < 4) {
    return fail('That polygon has fewer than three corners, so it does not enclose anything.');
  }

  const polygon = normalizeWinding({ type: 'Polygon', coordinates: largest.coordinates });

  return rest.length === 0
    ? { ok: true, polygon }
    : {
        ok: true,
        polygon,
        note: `Found ${polygons.length} polygons and kept the largest. A zone is a single polygon — import the others separately if they are separate zones.`,
      };
}

/** What the export button hands back: a Feature, because that is what every other tool expects. */
export function toGeoJsonExport(name: string, code: string, polygon: Polygon): string {
  return JSON.stringify(
    { type: 'Feature', properties: { name, code }, geometry: polygon },
    null,
    2,
  );
}
