import type { LineString, NamedZone, Point } from '@driverzone/geo';
import type { PickupChargeType, Zone, ZoneType } from './zone.entity.js';

/** PORT — what the domain needs from persistence, without naming Mongo. */

/**
 * What `createZone`/`updateZoneGeometry` write. Never carries `id`, `supersededBy`, `isActive`
 * or the timestamps — those are the repository's to assign (a fresh zone is always active,
 * never superseded, at the moment it is created).
 */
export type NewZone = Omit<Zone, 'id' | 'supersededBy' | 'isActive' | 'createdAt' | 'updatedAt'>;

/** Metadata-only patch — never touches `geometry` or `version`. See `updateZoneMetadata.usecase.ts`. */
export interface ZoneMetadataPatch {
  name?: string;
  code?: string;
  priority?: number;
  pickupChargeType?: PickupChargeType | null;
  pickupChargePaise?: number | null;
}

export interface ZoneListFilter {
  type?: ZoneType;
  /** Defaults to active-only at the repository if omitted — see the implementation. */
  isActive?: boolean;
}

export interface ZoneRepositoryPort {
  /** For the admin tree UI. Unfiltered fields are not constrained. */
  findMany(filter: ZoneListFilter): Promise<Zone[]>;

  /** The one query every quote depends on — see `resolveZonesAtPoint.usecase.ts`. */
  findContaining(point: Point): Promise<Zone[]>;

  findById(id: string): Promise<Zone | undefined>;

  findByCode(code: string): Promise<Zone | undefined>;

  /**
   * Active zones of the same type, for the Z-2 overlap check. Returns the `@driverzone/geo`
   * shape directly (`{ id, name, geom }`) since that is exactly what `checkOverlap` consumes —
   * no domain-to-geo remapping needed at the call site.
   *
   * `excludeId` matters when editing: a zone must never be checked for overlap against its own
   * previous version.
   */
  findSiblingsOfType(type: ZoneType, excludeId?: string): Promise<NamedZone[]>;

  /** DORMANT — terrain comes from the drop point now. See `findHillZonesForRoute.usecase.ts`. */
  findHillZonesIntersecting(route: LineString): Promise<Zone[]>;

  /** Inserts a new zone document. Create only — `version: 1`, nothing else active shares its code. */
  save(zone: NewZone): Promise<Zone>;

  /**
   * Z-5 — the versioned edit, atomically: deactivate `oldId`, insert `newZone`
   * (`version: old.version + 1`), then point `oldId.supersededBy` at the new document.
   *
   * Deactivating old BEFORE inserting new is not optional ordering — the partial unique index
   * on `code` (active zones only) would reject the insert if both were briefly active at once,
   * since the new version reuses the old one's code on purpose. Runs in a transaction so a
   * failure partway through never leaves a zone deactivated with no replacement.
   */
  replaceGeometry(oldId: string, newZone: NewZone): Promise<Zone>;

  /** Metadata edit, in place — no version bump, no audit-worthy geometry change. */
  updateMetadata(id: string, patch: ZoneMetadataPatch): Promise<Zone | undefined>;

  setActive(id: string, isActive: boolean): Promise<void>;

  /**
   * Permanent removal. Only ever called by `DeleteZoneUseCase` after confirming the zone is
   * already inactive — deleting an active zone bypasses `DeactivateZoneUseCase`'s audit trail
   * and leaves anything mid-flight resolving against a document that just vanished.
   */
  deleteById(id: string): Promise<void>;
}
