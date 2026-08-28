import type { PickupChargeType, ZoneType } from '@driverzone/contracts';
import type { Polygon } from '@driverzone/geo';

/**
 * The zones `pnpm seed` creates — Siliguri and the two hill districts above it.
 *
 * The sibling of `devAccounts.ts`, and here for the same reason: a fresh `docker compose down -v`
 * leaves a database with no polygons at all, which means nothing resolves, `/coverage` answers
 * "not served" for every point, and the zone map editor opens on an empty map. Everyone drew
 * their own zones to get past that, differently, which is exactly the reproducibility problem
 * `devAccounts.ts` exists to kill (docs/setup-development.md §Seed data).
 *
 * WHY THERE ARE NO FIXED `_id`s HERE, unlike `devAccounts.ts`. The seed creates these through
 * `zones.public.ts`, as docs/setup-development.md asks, so that `normalizeWinding` and the Z-2 /
 * Z-3 / Z-MIN-AREA / Z-MAX-AREA checks in `@driverzone/geo` run on every seeded polygon — the
 * seed cannot create geometry the app itself could never produce. `ZoneAdminContract.create()`
 * does not take an id, and widening it to accept one would put a hole in the module's write path
 * for the benefit of a fixture. So zone ids DIFFER BETWEEN MACHINES and `code` is the stable
 * cross-machine handle instead — which it already is, by the unique-on-active index in
 * `zone.model.ts`. Identity made the opposite trade because its rules are single-document and a
 * direct write breaks nothing; see `seed.ts`'s header.
 *
 * The coordinates are real Siliguri, matching the examples used throughout the docs, and are
 * axis-aligned rectangles on purpose: a fixture nobody can read is a fixture nobody will keep
 * correct. Draw the interesting shapes in the editor.
 */

export interface DevZone {
  type: ZoneType;
  name: string;
  code: string;
  /** `[lng, lat]`, closed ring. Winding is left to `normalizeWinding` on the write path. */
  geometry: Polygon;
  /** PICKUP only. Omitted for CITY/HILL, which `CreateZoneUseCase` rejects a charge on. */
  pickupChargeType?: PickupChargeType;
  /** Omitted means `null` — falls back to `pickup.default_charge` in `globalSettings`. */
  pickupChargePaise?: number;
}

const ring = (coordinates: [number, number][]): Polygon => ({
  type: 'Polygon',
  coordinates: [coordinates],
});

/**
 * The city. Contains all three PICKUP zones below, and both of `DEV_CUSTOMER`'s saved addresses.
 *
 * Not a containment INVARIANT — Z-1 (pickup ⊆ city) was retired 2026-08-25 and a PICKUP zone is a
 * flat serviceability gate now. It is a property of the fixture, so that the seeded customer's
 * addresses are inside a served city rather than nowhere.
 */
const SILIGURI = ring([
  [88.3, 26.65],
  [88.5, 26.65],
  [88.5, 26.8],
  [88.3, 26.8],
  [88.3, 26.65],
]);

/**
 * Both hill zones sit at lat ≥ 26.98, well north of the city's 26.8 — they must never touch it.
 *
 * Terrain is decided by the DROP POINT falling inside a HILL zone (`resolveAt(to).hill`,
 * docs/LLD/packages.md §Terrain), so a hill zone overlapping the city would make ordinary
 * in-city trips resolve as hill and quietly break outstation band matching.
 */
const DARJEELING = ring([
  [88.2, 26.98],
  [88.35, 26.98],
  [88.35, 27.12],
  [88.2, 27.12],
  [88.2, 26.98],
]);

const KALIMPONG = ring([
  [88.4, 27.02],
  [88.53, 27.02],
  [88.53, 27.14],
  [88.4, 27.14],
  [88.4, 27.02],
]);

/** Contains `SEVOKE_ROAD` (26.7271, 88.3953) — `DEV_CUSTOMER`'s preferred pickup address. */
const SLG_CENTRAL = ring([
  [88.38, 26.7],
  [88.42, 26.7],
  [88.42, 26.74],
  [88.38, 26.74],
  [88.38, 26.7],
]);

const SLG_NORTH = ring([
  [88.43, 26.745],
  [88.47, 26.745],
  [88.47, 26.775],
  [88.43, 26.775],
  [88.43, 26.745],
]);

/**
 * Deliberately does NOT contain `seed.ts`'s `MATIGARA` point (26.71, 88.43), despite the name —
 * that address is a few kilometres east of this rectangle.
 *
 * `DEV_CUSTOMER`'s two saved addresses therefore resolve DIFFERENTLY: Sevoke Road lands in
 * `SLG-CENTRAL` (free pickup), Matigara lands in the city with no pickup zone at all. One seeded
 * customer exercises both branches of the pickup-charge path, which is the whole point of the
 * pair. Widening this rectangle to swallow the second address would collapse that to one case.
 */
const SLG_MATIGARA = ring([
  [88.362, 26.685],
  [88.395, 26.685],
  [88.395, 26.698],
  [88.362, 26.698],
  [88.362, 26.685],
]);

/**
 * Ordered CITY, HILL, PICKUP — the order the seed creates them in, and the order they read in.
 *
 * Nothing depends on it: Z-2 forbids overlap only BETWEEN SIBLINGS OF THE SAME TYPE, so no zone
 * here is validated against a zone of another type and no creation order can fail.
 *
 * The two PAID pickup zones differ on purpose. `SLG-NORTH` carries an explicit ₹100;
 * `SLG-MATIGARA` leaves the amount null so it falls back to the global default. Both shapes have
 * to render and both have to price, and only one of them is the common case.
 */
export const DEV_ZONES: DevZone[] = [
  { type: 'CITY', name: 'Siliguri', code: 'SILIGURI', geometry: SILIGURI },

  { type: 'HILL', name: 'Darjeeling', code: 'HILL-DARJ', geometry: DARJEELING },
  { type: 'HILL', name: 'Kalimpong', code: 'HILL-KALIM', geometry: KALIMPONG },

  {
    type: 'PICKUP',
    name: 'Siliguri Central',
    code: 'SLG-CENTRAL',
    geometry: SLG_CENTRAL,
    pickupChargeType: 'FREE',
  },
  {
    type: 'PICKUP',
    name: 'Siliguri Paid North',
    code: 'SLG-NORTH',
    geometry: SLG_NORTH,
    pickupChargeType: 'PAID',
    pickupChargePaise: 10_000,
  },
  {
    type: 'PICKUP',
    name: 'Matigara',
    code: 'SLG-MATIGARA',
    geometry: SLG_MATIGARA,
    pickupChargeType: 'PAID',
  },
];
