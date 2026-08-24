import { validateZone, type Polygon } from '@driverzone/geo';
import { AppError } from '@/shared/errors/AppError.js';
import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { PickupChargeType, Zone, ZoneType } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneValidationFailed } from '../../domain/zone.errors.js';

export interface CreateZoneInput {
  type: ZoneType;
  name: string;
  code: string;
  /** Required when `type === 'PICKUP'`; must be absent otherwise (Z-4). */
  parentZoneId?: string | undefined;
  geometry: Polygon;
  priority?: number | undefined;
  pickupChargeType?: PickupChargeType | undefined;
  pickupChargePaise?: number | undefined;
}

/**
 * APPLICATION — the invariant choke point.
 *
 * Under PostGIS, Z-1/Z-2/Z-3/Z-MIN-AREA were database triggers: a bad polygon could not be
 * saved. MongoDB cannot express a cross-document geometric constraint, so this use case *is*
 * the guarantee — and it is only a real guarantee because `module-internals-are-private` stops
 * any other module from reaching `zones/infrastructure/zone.model.ts` directly
 * (docs/engineering/boundaries-and-enforcement.md).
 */
export class CreateZoneUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(input: CreateZoneInput, actor: ActorContext): Promise<Zone> {
    if (input.type === 'PICKUP' && !input.parentZoneId) {
      throw AppError.badRequest('A PICKUP zone requires a parent CITY zone.', {
        field: 'parent_zone_id',
      });
    }
    if (input.type !== 'PICKUP' && input.parentZoneId) {
      throw AppError.badRequest(`A ${input.type} zone must not have a parent.`, {
        field: 'parent_zone_id',
      });
    }

    let parentGeom: Polygon | undefined;
    if (input.type === 'PICKUP' && input.parentZoneId) {
      const parent = await this.zones.findById(input.parentZoneId);
      if (parent === undefined) {
        throw AppError.badRequest('Parent zone not found.', { field: 'parent_zone_id' });
      }
      if (parent.type !== 'CITY') {
        throw AppError.badRequest('The parent zone must be a CITY zone.', {
          field: 'parent_zone_id',
        });
      }
      parentGeom = parent.geometry;
    }

    const siblings = await this.zones.findSiblingsOfType(input.type);

    const violations = validateZone({
      geom: input.geometry,
      ...(parentGeom === undefined ? {} : { parentGeom }),
      siblings,
    });
    if (violations.some((v) => v.severity === 'ERROR')) {
      throw zoneValidationFailed(violations);
    }

    const saved = await this.zones.save({
      type: input.type,
      name: input.name,
      code: input.code,
      parentZoneId: input.type === 'PICKUP' ? (input.parentZoneId ?? null) : null,
      geometry: input.geometry,
      priority: input.priority ?? 0,
      pickupChargeType: input.type === 'PICKUP' ? (input.pickupChargeType ?? null) : null,
      pickupChargePaise: input.pickupChargePaise ?? null,
      version: 1,
      createdBy: actor.adminId,
    });

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Zone',
      entityId: saved.id,
      action: 'CREATE',
      after: { type: saved.type, name: saved.name, code: saved.code, geometry: saved.geometry },
      ip: actor.ip,
    });

    return saved;
  }
}
