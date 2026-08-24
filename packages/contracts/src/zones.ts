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

export interface ValidateZoneRequest {
  type: ZoneType;
  parent_zone_id?: string | undefined;
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
  /** Required when `type === 'PICKUP'`; must be absent otherwise. */
  parent_zone_id?: string | undefined;
  geometry: Polygon;
  priority?: number | undefined;
  pickup_charge_type?: PickupChargeType | undefined;
  pickup_charge_paise?: number | null | undefined;
}

export interface UpdateZoneGeometryRequest {
  geometry: Polygon;
}

export interface DeactivateZoneRequest {
  /** The admin-panel.md "[Deactivate anyway]" override. */
  force?: boolean | undefined;
}

export interface DeleteZoneResponse {
  deleted: true;
}

export interface ListZonesQuery {
  type?: ZoneType | undefined;
  parent_zone_id?: string | undefined;
  /** Defaults to `true` — inactive/superseded versions are opt-in. */
  is_active?: boolean | undefined;
}

export interface ListZonesResponse {
  zones: ZoneDto[];
}

/**
 * Zone-native dependents only — `child_pickup_zones` for a CITY zone. `packages`/`bookings`
 * sections are added once the `catalog`/`bookings` modules exist; this shape is designed so that
 * addition is additive, not breaking.
 */
export interface ZoneDependentsResponse {
  child_pickup_zones: ZoneDto[];
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
