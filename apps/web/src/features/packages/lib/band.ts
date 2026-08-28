import type { OutstationPackageDto, Terrain } from '@driverzone/contracts';

/**
 * Distance-band geometry, as pure functions so `vitest` can exercise it in `node` — this app's
 * tests are DOM-free on purpose (`vitest.config.ts`).
 *
 * Bands are HALF-OPEN `[minKm, maxKm)`. That is the whole reason `0–70` and `70–100` tile
 * cleanly: 70 km belongs to the second band, there is no gap between them and no distance that
 * two bands both claim. Every comparison below has to keep that asymmetry or the two failure
 * modes it prevents come straight back.
 */

export interface Band {
  minKm: number;
  maxKm: number;
}

/**
 * One cell of a coverage ladder. `to` is `null` for the open-ended tail — the stretch past the
 * furthest band, which is always uncovered and is the gap admins actually hit.
 */
export interface CoverageSegment {
  from: number;
  to: number | null;
  kind: 'covered' | 'gap';
  /** Set on a covered segment; the band that covers it. */
  packageId?: string;
  name?: string;
  /** Set when this segment overlaps the one before it — a P-2 violation that survived a write. */
  overlapsPrevious?: boolean;
}

export interface LadderBand extends Band {
  id: string;
  name: string;
}

/**
 * Turn a terrain's active bands into an ordered ladder of covered stretches and the holes
 * between them.
 *
 * This is the ONLY guard against a gap, and that asymmetry is the point (docs/LLD/packages.md
 * §Overlap). An overlap is caught three times — at write time by `findOverlappingBands`, by the
 * nightly integrity job, and again by read-time precedence. A gap is caught by nobody, because
 * nothing is wrong with any individual package: two adjacent bands failing to meet is a silence,
 * not an error. It only becomes visible when a customer asks for a distance nobody priced and
 * gets `NO_PACKAGE_FOR_DISTANCE` for a trip we would happily have taken.
 *
 * So it has to be visible on the screen where bands are edited, which means it has to be
 * computed here rather than asked of an API that has no reason to know.
 *
 * Overlapping input is rendered rather than rejected: the server forbids it, but if one ever
 * reaches this function the admin needs to SEE it, not get a blank ladder.
 */
export function buildCoverage(bands: readonly LadderBand[]): CoverageSegment[] {
  const ordered = [...bands].sort((a, b) => a.minKm - b.minKm || a.maxKm - b.maxKm);
  const segments: CoverageSegment[] = [];
  let cursor = 0;

  for (const band of ordered) {
    if (band.minKm > cursor) {
      segments.push({ from: cursor, to: band.minKm, kind: 'gap' });
    }
    segments.push({
      from: band.minKm,
      to: band.maxKm,
      kind: 'covered',
      packageId: band.id,
      name: band.name,
      ...(band.minKm < cursor ? { overlapsPrevious: true } : {}),
    });
    cursor = Math.max(cursor, band.maxKm);
  }

  // Always present, even with no bands at all: "everything is uncovered" is the most important
  // thing this ladder can say, and a ladder that renders as nothing says it worst.
  segments.push({ from: cursor, to: null, kind: 'gap' });
  return segments;
}

/** The active bands of one terrain, in the shape `buildCoverage` wants. */
export function ladderFor(
  packages: readonly OutstationPackageDto[],
  terrain: Terrain,
): LadderBand[] {
  return packages
    .filter((pkg) => pkg.is_active && pkg.terrain === terrain)
    .map((pkg) => ({ id: pkg.id, name: pkg.name, minKm: pkg.min_km, maxKm: pkg.max_km }));
}

/**
 * Mirrors `validateOutstationBand` in
 * `apps/api/src/modules/packages/domain/outstationPackage.entity.ts` (P-4).
 *
 * A copy of a server rule, which is normally the wrong instinct — but the server stays the
 * authority and this only decides whether to bother it. The value is that `100–100` is refused
 * where the admin typed it rather than after a round trip that returns a 400 pointing at nothing
 * in particular.
 */
export function validateBand(minKm: number, maxKm: number): string | null {
  if (!Number.isInteger(minKm) || !Number.isInteger(maxKm)) return 'Distances must be whole km.';
  if (minKm < 0) return 'The lower bound cannot be negative.';
  if (maxKm <= minKm) return 'The upper bound must be greater than the lower bound.';
  return null;
}

/**
 * The client-side half of P-2: no two ACTIVE bands of the same terrain may overlap.
 *
 * Half-open on both sides, exactly like the server's query — `minKm: { $lt: maxKm }` and
 * `maxKm: { $gt: minKm }` — so bands that merely touch at a boundary are not a conflict.
 *
 * Across terrains overlap is normal and intended: `0–70 PLAIN` and `0–70 HILL` are two
 * independent ladders, not a collision, which is why `terrain` scopes the whole search.
 *
 * The server still decides. A 409 `PACKAGE_BAND_OVERLAP` is authoritative and this is not — it
 * only sees what the list happened to load. Its job is to say so before the admin clicks Save.
 */
export function findOverlap(
  draft: Band & { terrain: Terrain; id?: string | undefined },
  packages: readonly OutstationPackageDto[],
): OutstationPackageDto | null {
  return (
    packages.find(
      (pkg) =>
        pkg.is_active &&
        pkg.terrain === draft.terrain &&
        pkg.id !== draft.id &&
        pkg.min_km < draft.maxKm &&
        pkg.max_km > draft.minKm,
    ) ?? null
  );
}

/** `0–70 km`, or `150 km and above` for the open tail. For labels and confirm dialogs. */
export function formatBand(from: number, to: number | null): string {
  return to === null ? `${from} km and above` : `${from}–${to} km`;
}

/**
 * The distances that stop being covered if this band goes away — the blast radius of a
 * deactivation, in the same spirit as the zones screen showing what a zone takes down with it.
 *
 * Computed by rebuilding the ladder without the band and reporting the gaps that appear, rather
 * than assuming the band's own range: a neighbour may already overlap part of it, in which case
 * less goes dark than the band's width suggests.
 */
export function coverageLostWithout(
  bands: readonly LadderBand[],
  removedId: string,
): CoverageSegment[] {
  const before = buildCoverage(bands);
  const after = buildCoverage(bands.filter((band) => band.id !== removedId));
  const gapKey = (segment: CoverageSegment) => `${segment.from}:${segment.to ?? '∞'}`;
  const alreadyOpen = new Set(before.filter((s) => s.kind === 'gap').map(gapKey));
  return after.filter((segment) => segment.kind === 'gap' && !alreadyOpen.has(gapKey(segment)));
}

/**
 * Validate a split point for a band.
 *
 * The point must be an integer STRICTLY inside `(minKm, maxKm)`. Allowing either endpoint would
 * produce a zero-width half — `0–0` or `150–150` — which P-4 forbids anyway, but refusing it
 * here means the admin is told before two writes have started rather than after the first one
 * has already shrunk the band.
 */
export function validateSplit(band: Band, splitKm: number): string | null {
  if (!Number.isInteger(splitKm)) return 'The split point must be a whole number of km.';
  if (splitKm <= band.minKm || splitKm >= band.maxKm) {
    return `The split point must be between ${band.minKm} and ${band.maxKm} km.`;
  }
  return null;
}

/** The two halves a split produces, both half-open and meeting exactly at `splitKm`. */
export function splitAt(band: Band, splitKm: number): [Band, Band] {
  return [
    { minKm: band.minKm, maxKm: splitKm },
    { minKm: splitKm, maxKm: band.maxKm },
  ];
}
