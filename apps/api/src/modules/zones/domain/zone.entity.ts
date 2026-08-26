import type { Polygon } from '@driverzone/geo';

/** DOMAIN — a zone, and what a point resolves to. Pure types, no I/O. */

export type ZoneType = 'CITY' | 'PICKUP' | 'HILL';
export type PickupChargeType = 'FREE' | 'PAID';

export interface Zone {
  id: string;
  type: ZoneType;
  name: string;
  code: string;
  /**
   * DORMANT, always `null`. Z-1 (pickup ⊆ city) retired 2026-08-25 — no zone type has a parent
   * any more (Z-4). Retained on the entity rather than deleted so a future nested-zone design
   * can switch it back on without a schema migration. See docs/decision-log.md.
   */
  parentZoneId: null;
  geometry: Polygon;
  /** Defensive tiebreak only — see `resolveZonesAtPoint.usecase.ts`. Should never actually decide anything. */
  priority: number;
  pickupChargeType: PickupChargeType | null;
  /** Null falls back to the global default once `settings` exists. */
  pickupChargePaise: number | null;
  version: number;
  supersededBy: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What a point resolves to — at most one active zone per type, by invariant Z-2.
 *
 * `all` keeps every match (defensive; normally 0–3 entries) so a caller can detect the
 * "more than one zone of a type matched" case, which should be structurally impossible and is
 * therefore worth surfacing rather than silently picking one — see `resolveZonesAtPoint`.
 */
export interface ResolvedZones {
  city: Zone | null;
  pickup: Zone | null;
  hill: Zone | null;
  all: Zone[];
}
