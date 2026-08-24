import { validateZone, type Polygon } from '@driverzone/geo';
import { AppError } from '@/shared/errors/AppError.js';
import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneNotFound, zoneValidationFailed } from '../../domain/zone.errors.js';

export interface UpdateZoneGeometryInput {
  geometry: Polygon;
}

/**
 * APPLICATION — Z-5: editing geometry never mutates a zone in place.
 *
 * Writes a new document (`version: old.version + 1`) and marks the old one
 * `isActive: false` / `supersededBy: new.id`, rather than updating `old` directly. This is what
 * lets `docs/LLD/open-questions.md` Q11 hold ("a booking that already resolved against the old
 * geometry keeps its snapshot") — the old geometry is never gone, just superseded.
 *
 * Does not re-point package references onto the new zone id — `catalog` does not exist yet.
 * Once it does, that repointing belongs to whichever module composes `zones` + `catalog`
 * (likely `admin`), since neither of those may depend on the other directly.
 */
export class UpdateZoneGeometryUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(zoneId: string, input: UpdateZoneGeometryInput, actor: ActorContext): Promise<Zone> {
    const old = await this.zones.findById(zoneId);
    if (old === undefined) throw zoneNotFound();
    if (!old.isActive) {
      throw AppError.conflict('This zone has already been superseded by a later version.', {
        superseded_by: old.supersededBy,
      });
    }

    let parentGeom: Polygon | undefined;
    if (old.type === 'PICKUP' && old.parentZoneId) {
      const parent = await this.zones.findById(old.parentZoneId);
      // Z-1 should already guarantee this exists; a missing parent here means it happened
      // anyway, which is exactly the config fault the resolution algorithm is built to page on.
      if (parent === undefined) {
        throw AppError.internal('ZONE_CONFIG_FAULT', {
          zoneId: old.id,
          reason: 'parent zone missing',
        });
      }
      parentGeom = parent.geometry;
    }

    const siblings = await this.zones.findSiblingsOfType(old.type, old.id);

    const violations = validateZone({
      geom: input.geometry,
      ...(parentGeom === undefined ? {} : { parentGeom }),
      siblings,
    });
    if (violations.some((v) => v.severity === 'ERROR')) {
      throw zoneValidationFailed(violations);
    }

    const updated = await this.zones.save({
      type: old.type,
      name: old.name,
      code: old.code,
      parentZoneId: old.parentZoneId,
      geometry: input.geometry,
      priority: old.priority,
      pickupChargeType: old.pickupChargeType,
      pickupChargePaise: old.pickupChargePaise,
      version: old.version + 1,
      createdBy: actor.adminId,
    });

    await this.zones.supersede(old.id, updated.id);

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
