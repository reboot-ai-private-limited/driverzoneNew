import type { LineString, NamedZone, Point } from '@driverzone/geo';
import type { Zone, ZoneType } from './zone.entity.js';

/** PORT — what the domain needs from persistence, without naming Mongo. */

/**
 * What `createZone`/`updateZoneGeometry` write. Never carries `id`, `supersededBy`, `isActive`
 * or the timestamps — those are the repository's to assign (a fresh zone is always active,
 * never superseded, at the moment it is created).
 */
export type NewZone = Omit<Zone, 'id' | 'supersededBy' | 'isActive' | 'createdAt' | 'updatedAt'>;

export interface ZoneListFilter {
  type?: ZoneType;
  parentZoneId?: string;
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

  /** Active PICKUP children of a CITY zone — powers dependents/blast-radius checks. */
  findChildren(parentZoneId: string): Promise<Zone[]>;

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

  /** Inserts a new zone document, `version: 1` for a create or `old.version + 1` for an edit. */
  save(zone: NewZone): Promise<Zone>;

  /** Z-5 — marks `oldId` inactive and superseded by `newId`, in one write. */
  supersede(oldId: string, newId: string): Promise<void>;

  setActive(id: string, isActive: boolean): Promise<void>;

  /** Hard delete. Only ever called after the use case has confirmed nothing references the row. */
  deleteById(id: string): Promise<void>;
}
