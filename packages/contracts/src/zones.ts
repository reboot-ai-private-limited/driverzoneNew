import type { Polygon } from 'geojson';

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
  parent_zone_id?: string;
  geometry: Polygon;
  /** Set when editing, so the zone does not conflict with its own previous version. */
  exclude_zone_id?: string;
}

export interface ValidateZoneResponse {
  valid: boolean;
  violations: ZoneViolationDto[];
  stats: {
    area_km2: number;
    vertex_count: number;
  };
}
