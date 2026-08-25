import { area } from '@turf/area';
import { booleanOverlap } from '@turf/boolean-overlap';
import { booleanWithin } from '@turf/boolean-within';
import { difference } from '@turf/difference';
import { featureCollection, polygon as turfPolygon } from '@turf/helpers';
import { intersect } from '@turf/intersect';
import { kinks } from '@turf/kinks';
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

export type ZoneRule = 'Z-1' | 'Z-2' | 'Z-3' | 'Z-MIN-AREA' | 'Z-COMPLEXITY';
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
 * Z-1 — a PICKUP zone lies entirely inside its parent CITY zone.
 *
 * This is the invariant that makes the ZONE_CONFIG_FAULT branch in docs/LLD/zone-resolution.md unreachable: if a
 * pickup polygon can never be saved outside its city, resolution can never find one there.
 *
 * The violation carries the spilling area as geometry so the editor can paint exactly which
 * corner is wrong. "0.42 km² outside Siliguri" plus a red patch on the map is a ten-second
 * fix; "invalid zone" is a guessing game across thirty-four vertices.
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
  /** Required for PICKUP zones — the CITY polygon it must sit inside. */
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
