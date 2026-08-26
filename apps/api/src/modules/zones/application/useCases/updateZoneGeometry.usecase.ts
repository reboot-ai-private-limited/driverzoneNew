import { normalizeWinding, validateZone, type Polygon } from '@driverzone/geo';
import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneAlreadySuperseded, zoneNotFound, zoneValidationFailed } from '../../domain/zone.errors.js';

export interface UpdateZoneGeometryInput {
  geometry: Polygon;
  /** Must match the zone's current `version`, or the edit is refused (ZONE_ALREADY_SUPERSEDED). */
  expectedVersion: number;
}

/**
 * APPLICATION — Z-5: editing geometry never mutates a zone in place.
 *
 * `replaceGeometry` writes a new document (`version: old.version + 1`) and marks the old one
 * `isActive: false` / `supersededBy: new.id`, rather than updating `old` directly — atomically,
 * in one transaction, since deactivating old and inserting new happen in that specific order
 * (see the repository method's own doc comment for why the order is load-bearing, not
 * cosmetic). This is what lets `docs/LLD/open-questions.md` Q11 hold ("a booking that already
 * resolved against the old geometry keeps its snapshot") — the old geometry is never gone, just
 * superseded.
 *
 * `expectedVersion` guards two admins editing the same polygon from two tabs: the second save
 * refuses with `ZONE_ALREADY_SUPERSEDED` rather than silently overwriting the first.
 *
 * No parent lookup: Z-1 is retired, `parentZoneId` is always `null`
 * (docs/LLD/zones.md). No package re-pointing either — packages don't reference pickup zones,
 * and an incity package's `cityZoneId` is a separate concern this use case doesn't touch.
 */
export class UpdateZoneGeometryUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(zoneId: string, input: UpdateZoneGeometryInput, actor: ActorContext): Promise<Zone> {
    const old = await this.zones.findById(zoneId);
    if (old === undefined) throw zoneNotFound();
    if (!old.isActive || old.version !== input.expectedVersion) {
      throw zoneAlreadySuperseded(zoneId, old.version);
    }

    const geometry = normalizeWinding(input.geometry);

    const siblings = await this.zones.findSiblingsOfType(old.type, old.id);

    const violations = validateZone({ geom: geometry, siblings });
    if (violations.some((v) => v.severity === 'ERROR')) {
      throw zoneValidationFailed(violations);
    }

    const updated = await this.zones.replaceGeometry(old.id, {
      type: old.type,
      name: old.name,
      code: old.code,
      parentZoneId: null,
      geometry,
      priority: old.priority,
      pickupChargeType: old.pickupChargeType,
      pickupChargePaise: old.pickupChargePaise,
      version: old.version + 1,
      createdBy: actor.adminId,
    });

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Zone',
      entityId: updated.id,
      action: 'UPDATE',
      before: { geometry: old.geometry, version: old.version },
      after: { geometry: updated.geometry, version: updated.version },
      ip: actor.ip,
    });

    return updated;
  }
}
