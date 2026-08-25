import type { Polygon } from 'geojson';

/**
 * `apps/api` compiles with `exactOptionalPropertyTypes`, under which `?: string` and
 * `?: string | undefined` are different types — the first forbids `{ field: undefined }`, the
 * second permits it. Zod's `.optional()` produces the permissive one, and
 * `zones/interface/zones.typecheck.ts` compares the two exactly, so every REQUEST/QUERY field
 * below spells out `| undefined` explicitly (see `identity.ts` for the same convention).
 * Response/DTO shapes below are hand-built, never parsed by Zod, and do not need it.
 */

export const ZONE_TYPES = ['CITY', 'PICKUP', 'HILL'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export type PickupChargeType = 'FREE' | 'PAID';

export interface ZoneDto {
  id: string;
  type: ZoneType;
  name: string;
  code: string;
  /** DORMANT, always `null` — Z-1 retired 2026-08-25. See docs/LLD/zones.md. */
  parent_zone_id: string | null;
  geometry: Polygon;
  priority: number;
  pickup_charge_type?: PickupChargeType;
  /** Null falls back to the global default. */
  pickup_charge_paise?: number | null;
  version: number;
  is_active: boolean;
}

/** Mirrors ZoneViolation in @driverzone/geo — the same shape crosses the wire. */
export interface ZoneViolationDto {
  rule: string;
  severity: 'ERROR' | 'WARN' | 'INFO';
  message: string;
  offendingGeometry?: Polygon;
}

/** No `parent_zone_id` — Z-1 is retired, nothing supplies one any more (docs/LLD/zones.md). */
export interface ValidateZoneRequest {
  type: ZoneType;
  geometry: Polygon;
  /** Set when editing, so the zone does not conflict with its own previous version. */
  exclude_zone_id?: string | undefined;
}

export interface ValidateZoneResponse {
  valid: boolean;
  violations: ZoneViolationDto[];
  stats: {
    area_km2: number;
    vertex_count: number;
  };
}

export interface CreateZoneRequest {
  type: ZoneType;
  name: string;
  code: string;
  geometry: Polygon;
  priority?: number | undefined;
  /** PICKUP only. */
  pickup_charge_type?: PickupChargeType | undefined;
  pickup_charge_paise?: number | null | undefined;
}

export interface UpdateZoneGeometryRequest {
  geometry: Polygon;
  /** Must match the zone's current `version`, or the edit is refused (409 ZONE_ALREADY_SUPERSEDED). */
  expected_version: number;
}

/** Name, code, priority, pickup charge — never geometry, never `version`. Separate route, separate concerns. */
export interface UpdateZoneMetadataRequest {
  name?: string | undefined;
  code?: string | undefined;
  priority?: number | undefined;
  pickup_charge_type?: PickupChargeType | null | undefined;
  pickup_charge_paise?: number | null | undefined;
}

export interface ListZonesQuery {
  type?: ZoneType | undefined;
  /** Defaults to `true` — inactive/superseded versions are opt-in. */
  is_active?: boolean | undefined;
}

export interface ListZonesResponse {
  zones: ZoneDto[];
}

/**
 * Human-readable blast-radius warnings, shown before an admin deactivates
 * (`DELETE /admin/zones/:id` is soft-deactivate — see docs/LLD/zones.md). Never blocks;
 * deactivation is always allowed. Empty when there's nothing to flag.
 */
export interface ZoneDependentsResponse {
  warnings: string[];
}

/** `DELETE /admin/zones/:id/hard` — permanent. Only allowed once the zone is already inactive. */
export interface DeleteZoneResponse {
  deleted: true;
}

export interface CoverageCheckQuery {
  lat: number;
  lng: number;
}

/** `GET /coverage/check` — the pre-flight, before a customer types a destination. */
export interface CoverageCheckResponse {
  covered: boolean;
  city: ZoneDto | null;
  pickup: ZoneDto | null;
}
