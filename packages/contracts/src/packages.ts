/**
 * The packages wire format. `apps/api/src/modules/packages/interface/packages.swagger.ts`
 * declares its response DTOs as "mirroring @driverzone/contracts's packages.ts field-for-field"
 * — this is that file, and `packages.typecheck.ts` is what makes the claim true rather than
 * aspirational.
 *
 * PRICE DOES NOT VARY BY CAR CATEGORY. It used to: every package carried a `prices[]`
 * subdocument keyed by category, and for outstation by `(category, direction)` — ten rows per
 * distance band. Retired 2026-08-28 (docs/decision-log.md). A band is now two fares and a
 * commission split; a variant is a duration and a fare. `CAR_CATEGORIES` still exists, in
 * `identity.ts`, because dispatch and bookings still need it — it just no longer decides what
 * anything costs.
 *
 * `apps/api` compiles with `exactOptionalPropertyTypes`, under which `?: string` and
 * `?: string | undefined` are different types. Zod's `.optional()` produces the permissive one,
 * so every REQUEST/QUERY field below spells out `| undefined` explicitly — the same convention
 * `zones.ts` and `identity.ts` follow. DTO shapes are hand-built by the mapper, never parsed by
 * Zod, and do not need it.
 */

/**
 * `ROUND_TRIP` is the whole two-way journey — out to the destination and back — and it is a
 * SEPARATE fare, never a computed multiple of the one-way. The driver's day differs in kind: they
 * wait at the destination, they may get no return fare, and they may be away overnight.
 *
 * The band is matched on the ONE-WAY distance. A 540 km destination matches the band containing
 * 540, and that band's return fare covers all 1,080 km of driving.
 */
export const DIRECTIONS = ['ONE_WAY', 'ROUND_TRIP'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/**
 * Mirrors `Terrain` in @driverzone/geo, which is a bare type alias with no runtime companion.
 * `packages.validation.ts` pins this list against that alias with `satisfies`, so the two cannot
 * drift; the copy lives here so the web app gets the values without depending on `geo`.
 */
export const TERRAINS = ['PLAIN', 'HILL'] as const;
export type Terrain = (typeof TERRAINS)[number];

/**
 * The driver's share, in BASIS POINTS — 7500 is 75%, and the API rejects anything above 10000.
 *
 * THE COMPANY'S SHARE IS DERIVED, never stored: `10000 − driver_commission_bps`. Storing both
 * let a form save 75% and 20% and quietly leave 5% of every trip in nobody's column; there is no
 * longer a pair that can disagree. Basis points rather than a float percent so the money rule
 * holds — integers everywhere (docs/engineering/coding-standards.md §Money).
 */
export function companyCommissionBps(driverCommissionBps: number): number {
  return 10000 - driverCommissionBps;
}

// ─── InCity ──────────────────────────────────────────────────────────────────────────────────

/**
 * A duration and a price. The customer picks one, so a quote returns every active variant rather
 * than the cheapest.
 *
 * THERE IS NO OVERAGE. `included_minutes` is what the customer buys and what tells the driver
 * when they are released; running past it is an operations conversation, not a fare line. The
 * `extra_minute_rate_paise` / `extra_km_rate_paise` pair and the `included_km` cap they billed
 * against were removed 2026-08-28, closing open-questions.md Q2 by deciding there is nothing to
 * bill.
 *
 * No night charge either: the early-morning and late-night surcharges are GLOBAL, set once in
 * `globalSettings` rather than per package.
 */
export interface IncityVariantDto {
  id: string;
  label: string;
  included_minutes: number;
  base_fare_paise: number;
  driver_commission_bps: number;
  is_active: boolean;
}

/**
 * The only zone reference either product carries. Outstation packages reference no zone at all;
 * neither references a pickup zone (docs/LLD/packages.md §The two products).
 */
export interface IncityPackageDto {
  id: string;
  city_zone_id: string;
  name: string;
  description?: string;
  variants: IncityVariantDto[];
  is_active: boolean;
}

export interface ListIncityPackagesResponse {
  packages: IncityPackageDto[];
}

/**
 * `GET /admin/packages/incity` takes no `city_zone_id` filter, and does not need one: there is
 * one city zone, so the whole list is the city's list. Callers that want a specific zone's
 * packages filter client-side — see `packagesForZone` in apps/web.
 */
export interface ListIncityPackagesQuery {
  is_active?: boolean | undefined;
}

// ─── Outstation ──────────────────────────────────────────────────────────────────────────────

/**
 * A distance band, and the whole of its pricing.
 *
 * Bands are half-open `[min_km, max_km)`, so `0–70` and `70–100` tile with neither a gap nor a
 * double cover and 70 km belongs to the second. Two active bands of the SAME terrain may not
 * overlap (P-2); across terrains overlap is normal — `0–70 PLAIN` and `0–70 HILL` are two
 * independent ladders, not a conflict.
 *
 * THE FARE IS FLAT ACROSS THE BAND. 72 km and 98 km both pay the `70–100` fare; there is no
 * per-km rate on top. That closes open-questions.md Q3, which warned what it costs: flat pricing
 * needs many narrow bands, which is why splitting a band is a first-class action in the admin
 * panel rather than an edit-then-create dance.
 */
export interface OutstationPackageDto {
  id: string;
  name: string;
  terrain: Terrain;
  min_km: number;
  max_km: number;
  one_way_fare_paise: number;
  /**
   * The fare for the whole TWO-WAY journey — out and back — for a destination in this band. It
   * is not capped to same-day: however many days the driver is away, this one number covers it.
   *
   * `null` means the band does not sell a return trip at all. Never that the return is free.
   */
  round_trip_fare_paise: number | null;
  driver_commission_bps: number;
  is_active: boolean;
}

export interface ListOutstationPackagesResponse {
  packages: OutstationPackageDto[];
}

export interface ListOutstationPackagesQuery {
  is_active?: boolean | undefined;
  terrain?: Terrain | undefined;
}

// ─── Writes ──────────────────────────────────────────────────────────────────────────────────

/**
 * Field names on the write side are CAMELCASE, matching the Mongoose schemas rather than the
 * snake_case of the DTOs above.
 *
 * That asymmetry is not a decision anyone would make twice, but it is the shape the API has and
 * the drift guard pins it, which is strictly better than the previous state where nothing pinned
 * anything. Aligning the request bodies is a separate change with its own caller migration.
 */
export interface IncityVariantInput {
  label: string;
  includedMinutes: number;
  baseFarePaise: number;
  driverCommissionBps: number;
  isActive?: boolean | undefined;
}

export interface CreateIncityPackageRequest {
  cityZoneId: string;
  name: string;
  description?: string | undefined;
  variants: IncityVariantInput[];
  isActive?: boolean | undefined;
}

/**
 * `PUT`, not `PATCH`: the handler REPLACES `variants` wholesale rather than merging into it, so
 * a caller sending a partial variant list deletes the rest. The editor submits the full array.
 *
 * Spelled out rather than `Partial<CreateIncityPackageRequest>`, which is not the same type here:
 * under `exactOptionalPropertyTypes`, `Partial<T>` turns a required `name: string` into
 * `name?: string` — present-and-undefined forbidden — while Zod's `.partial()` produces
 * `name?: string | undefined`, which permits it. The drift guard catches the difference.
 */
export interface UpdateIncityPackageRequest {
  cityZoneId?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  variants?: IncityVariantInput[] | undefined;
  isActive?: boolean | undefined;
}

export interface CreateOutstationPackageRequest {
  name: string;
  terrain: Terrain;
  minKm: number;
  maxKm: number;
  oneWayFarePaise: number;
  /** Omit or send `null` for a band that does not sell a return trip. */
  roundTripFarePaise?: number | null | undefined;
  driverCommissionBps: number;
  isActive?: boolean | undefined;
}

/** Same wholesale-replacement caveat, and the same reason for not using `Partial<>`. */
export interface UpdateOutstationPackageRequest {
  name?: string | undefined;
  terrain?: Terrain | undefined;
  minKm?: number | undefined;
  maxKm?: number | undefined;
  oneWayFarePaise?: number | undefined;
  roundTripFarePaise?: number | null | undefined;
  driverCommissionBps?: number | undefined;
  isActive?: boolean | undefined;
}

/** `data` on a 409 PACKAGE_BAND_OVERLAP, so the editor can link straight to the conflict. */
export interface PackageBandOverlapDetails {
  conflictingPackageId: string;
}
