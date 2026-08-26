import { area } from '@turf/area';
import { booleanOverlap } from '@turf/boolean-overlap';
import { booleanWithin } from '@turf/boolean-within';
import { difference } from '@turf/difference';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { intersect } from '@turf/intersect';
import { kinks } from '@turf/kinks';
import { rewind } from '@turf/rewind';
import type { Feature, Polygon } from 'geojson';

/**
 * The zone invariants from docs/LLD/domain-model.md, as pure functions.
 *
 * Under PostGIS these were database triggers, so an invalid polygon was impossible to save.
 * MongoDB cannot express a cross-document geometric constraint, so the checks moved here —
 * which means they are only as good as the guarantee that every write goes through them.
 *
 * That guarantee is structural, not conventional: `.dependency-cruiser.cjs` forbids any
 * module outside `zones` from reaching `zones/infrastructure/`, so the zones module's write
 * path is the only way a polygon reaches the database. `pnpm lint:deps` is therefore
 * load-bearing for data integrity here, not merely tidiness — see
 * docs/engineering/boundaries-and-enforcement.md.
 *
 * These run unchanged in the browser, so the admin map editor validates live as the polygon
 * is drawn rather than on submit (docs/LLD/admin-panel.md §Live validation).
 */

export type ZoneRule = 'Z-1' | 'Z-2' | 'Z-3' | 'Z-MIN-AREA' | 'Z-MAX-AREA' | 'Z-COMPLEXITY';
export type ViolationSeverity = 'ERROR' | 'WARN' | 'INFO';

export interface ZoneViolation {
  rule: ZoneRule;
  severity: ViolationSeverity;
  message: string;
  /** The part of the polygon at fault, for the editor to paint red. */
  offendingGeometry?: Polygon;
}

/** Smallest polygon we accept as a serviceable zone: 1 hectare. */
const MIN_AREA_SQM = 10_000;

/**
 * Largest polygon we accept as an operational zone: 100,000 km². Generous — bigger than West
 * Bengal — because a HILL zone legitimately spans several districts. The point is not to
 * constrain a real zone; it is to reject a mistake (an accidental country-sized selection, or a
 * ring-winding bug reading a polygon as its own complement) long before that bug's actual
 * hemisphere-scale threshold, where the symptom would otherwise be silent.
 */
const MAX_AREA_SQM = 100_000_000_000;

/**
 * Same-type polygons drawn by hand share a border imprecisely. A strict overlap test rejects
 * legitimate neighbours, so genuine overlap means more than this many square metres —
 * matching the tolerance the PostGIS trigger used.
 */
const OVERLAP_TOLERANCE_SQM = 100;

/** Above this, lookups stay correct but the editor gets sluggish and the document gets large. */
const VERTEX_WARN_THRESHOLD = 500;

const asFeature = (p: Polygon): Feature<Polygon> => turfPolygon(p.coordinates);

function vertexCount(p: Polygon): number {
  return p.coordinates.reduce((n, ring) => n + ring.length, 0);
}

/**
 * Z-3 — the polygon is topologically sound.
 *
 * Map-drawing UIs produce self-intersecting "bowtie" polygons routinely, by dragging one
 * vertex across an edge. Turf's predicates give undefined — not wrong, *undefined* — results
 * on those, so a bowtie zone would resolve inconsistently rather than failing outright.
 */
export function checkValidity(geom: Polygon): ZoneViolation[] {
  const violations: ZoneViolation[] = [];

  const outer = geom.coordinates[0];
  if (!outer || outer.length < 4) {
    violations.push({
      rule: 'Z-3',
      severity: 'ERROR',
      message: 'A polygon needs at least three distinct corners.',
    });
    return violations;
  }

  const first = outer[0];
  const last = outer[outer.length - 1];
  if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
    violations.push({
      rule: 'Z-3',
      severity: 'ERROR',
      message: 'The polygon ring is not closed — its last point must repeat its first.',
    });
    return violations;
  }

  if (kinks(asFeature(geom)).features.length > 0) {
    violations.push({
      rule: 'Z-3',
      severity: 'ERROR',
      message: 'The polygon crosses itself. Drag the crossing corner clear of the opposite edge.',
    });
  }

  if (vertexCount(geom) > VERTEX_WARN_THRESHOLD) {
    violations.push({
      rule: 'Z-COMPLEXITY',
      severity: 'WARN',
      message: `${vertexCount(geom)} points is very detailed for a service zone. Consider simplifying.`,
    });
  }

  return violations;
}

export interface ZoneStats {
  areaKm2: number;
  vertexCount: number;
}

/**
 * Informational only — not an invariant, nothing here blocks a save. Backs the `stats` field on
 * `POST /admin/zones/validate` (docs/LLD/api-contracts.md) and the editor's live area readout.
 */
export function zoneStats(geom: Polygon): ZoneStats {
  return { areaKm2: area(asFeature(geom)) / 1_000_000, vertexCount: vertexCount(geom) };
}

/** Z-MIN-AREA — a zone too small to contain a pickup is a mis-draw, not a zone. */
export function checkMinimumArea(geom: Polygon): ZoneViolation[] {
  const sqm = area(asFeature(geom));
  if (sqm >= MIN_AREA_SQM) return [];
  return [
    {
      rule: 'Z-MIN-AREA',
      severity: 'ERROR',
      message: `Zone covers only ${Math.round(sqm)} m². The minimum is ${MIN_AREA_SQM / 10_000} hectare.`,
    },
  ];
}

/**
 * Z-MAX-AREA — implausibly large for an operational zone.
 *
 * Same family of bug as ring winding (see `normalizeWinding` below): a single-ring polygon
 * larger than a hemisphere is read by MongoDB's `2dsphere` index as its own complement, with no
 * error anywhere. This catches the mistake at a much smaller, still-implausible size, long
 * before geometry reaches that failure mode.
 */
export function checkMaximumArea(geom: Polygon): ZoneViolation[] {
  const sqm = area(asFeature(geom));
  if (sqm <= MAX_AREA_SQM) return [];
  return [
    {
      rule: 'Z-MAX-AREA',
      severity: 'ERROR',
      message: `Zone covers ${(sqm / 1_000_000).toFixed(0)} km², which is implausible for an operational zone. Check for an accidental selection or an inverted ring.`,
    },
  ];
}

/**
 * Ring-winding normalization — RFC 7946 wants exterior rings counter-clockwise. Turf's
 * predicates above are indifferent to winding; MongoDB's `2dsphere` index is not, and reads a
 * clockwise exterior ring as the whole earth except that shape. This does not throw anywhere,
 * so the fix is to normalize before anything else runs, not to detect and reject.
 *
 * MUST run first, before `validateZone` and before save — every check above, and the index
 * itself, decides inside from outside by winding. Map editors and imported GeoJSON both produce
 * clockwise rings routinely, so this is not a defensive rarity, it is the common case.
 */
/**
 * Same structural pre-checks `checkValidity` runs before it ever touches Turf — repeated here
 * because `@turf/helpers`' `polygon()` constructor (which both `asFeature` and `rewind` go
 * through) *throws* on a too-short or unclosed ring rather than returning a violation. Skipping
 * the rewind and handing the geometry back unchanged for these inputs is safe: they are already
 * going to be rejected by `checkValidity`'s own Z-3 checks, and winding is moot for a ring that
 * isn't a valid ring yet.
 */
function isStructurallySound(geom: Polygon): boolean {
  const outer = geom.coordinates[0];
  if (!outer || outer.length < 4) return false;
  const first = outer[0];
  const last = outer[outer.length - 1];
  return first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1];
}

export function normalizeWinding(geom: Polygon): Polygon {
  if (!isStructurallySound(geom)) return geom;

  const result = rewind(asFeature(geom), { mutate: false });
  // @turf/rewind's return type is loosely `Geometry | Feature | FeatureCollection` regardless
  // of input — narrow it for real rather than casting past the compiler.
  if (!('geometry' in result) || result.geometry.type !== 'Polygon') {
    throw new Error('normalizeWinding: expected a Polygon feature back from rewind()');
  }
  return result.geometry;
}

/**
 * Z-1 — a child zone lies entirely inside a parent zone. **Retired 2026-08-25 and DORMANT**:
 * pickup zones no longer have a parent (docs/LLD/zones.md, docs/decision-log.md) — they are a
 * serviceability gate, not a sub-area of a city. `validateZone` below only calls this when a
 * `parentGeom` is supplied, and nothing in `zones` supplies one anymore.
 *
 * Kept, not deleted: a future nested-zone design switches this back on by passing `parentGeom`
 * again, rather than rewriting it. The violation still carries the spilling area as geometry so
 * the editor can paint exactly which corner is wrong, for whenever that happens.
 */
export function checkWithinParent(child: Polygon, parent: Polygon): ZoneViolation[] {
  if (booleanWithin(asFeature(child), asFeature(parent))) return [];

  const outside = difference(featureCollection([asFeature(child), asFeature(parent)]));
  const outsideSqm = outside ? area(outside) : 0;

  return [
    {
      rule: 'Z-1',
      severity: 'ERROR',
      message:
        outsideSqm > 0
          ? `Extends ${(outsideSqm / 1_000_000).toFixed(2)} km² outside its city zone.`
          : 'Not fully inside its city zone.',
      ...(outside?.geometry.type === 'Polygon' ? { offendingGeometry: outside.geometry } : {}),
    },
  ];
}

export interface NamedZone {
  id: string;
  name: string;
  geom: Polygon;
}

/**
 * Z-2 — no two active zones of the same type overlap.
 *
 * Without this, a point can land in two pickup zones and resolution becomes non-deterministic:
 * the customer's price depends on which document Mongo happened to return first.
 *
 * `booleanOverlap` alone is too strict — it is true for neighbours sharing an imprecisely drawn
 * border. The area test is what separates a real overlap from a hand-drawing artefact.
 */
export function checkOverlap(candidate: Polygon, existing: NamedZone[]): ZoneViolation[] {
  const cf = asFeature(candidate);

  for (const other of existing) {
    const of_ = asFeature(other.geom);
    if (!booleanOverlap(cf, of_) && !booleanWithin(cf, of_) && !booleanWithin(of_, cf)) continue;

    const shared = intersect(featureCollection([cf, of_]));
    if (!shared) continue;

    const sharedSqm = area(shared);
    if (sharedSqm <= OVERLAP_TOLERANCE_SQM) continue;

    return [
      {
        rule: 'Z-2',
        severity: 'ERROR',
        message: `Overlaps "${other.name}" by ${(sharedSqm / 1_000_000).toFixed(3)} km².`,
        ...(shared.geometry.type === 'Polygon' ? { offendingGeometry: shared.geometry } : {}),
      },
    ];
  }

  return [];
}

export interface ZoneValidationInput {
  geom: Polygon;
  /** DORMANT — Z-1 is retired and nothing in `zones` supplies this. See `checkWithinParent`. */
  parentGeom?: Polygon;
  /** Active zones of the SAME type, excluding the one being edited. */
  siblings?: NamedZone[];
}

/**
 * Every invariant, in one call. Backs `POST /admin/zones/validate` (docs/LLD/api-contracts.md) and the live
 * editor feedback (docs/LLD/admin-panel.md). Save is blocked while any ERROR stands.
 */
export function validateZone(input: ZoneValidationInput): ZoneViolation[] {
  const violations = checkValidity(input.geom);

  // Every predicate below is undefined on a self-intersecting polygon, so stop here rather
  // than report confident nonsense derived from one.
  if (violations.some((v) => v.rule === 'Z-3' && v.severity === 'ERROR')) return violations;

  violations.push(...checkMinimumArea(input.geom));
  violations.push(...checkMaximumArea(input.geom));
  if (input.parentGeom) violations.push(...checkWithinParent(input.geom, input.parentGeom));
  if (input.siblings?.length) violations.push(...checkOverlap(input.geom, input.siblings));

  return violations;
}

/**
 * The one-click fix offered when Z-1 fails: clip the drawn polygon to its parent city.
 *
 * Returns null when nothing survives the clip — a polygon drawn entirely outside its city,
 * which is a different mistake and needs a different message.
 */
export function clipToParent(child: Polygon, parent: Polygon): Polygon | null {
  const clipped = intersect(featureCollection([asFeature(child), asFeature(parent)]));
  return clipped?.geometry.type === 'Polygon' ? clipped.geometry : null;
}
