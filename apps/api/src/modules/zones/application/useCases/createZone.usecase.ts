import { normalizeWinding, validateZone, type Polygon } from '@driverzone/geo';
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
  geometry: Polygon;
  priority?: number | undefined;
  /** PICKUP only — ignored for CITY/HILL. */
  pickupChargeType?: PickupChargeType | undefined;
  pickupChargePaise?: number | undefined;
}

/**
 * APPLICATION — the invariant choke point.
 *
 * Under PostGIS, Z-2/Z-3/Z-MIN-AREA/Z-MAX-AREA were database triggers: a bad polygon could not
 * be saved. MongoDB cannot express a cross-document geometric constraint, so this use case *is*
 * the guarantee — and it is only a real guarantee because `module-internals-are-private` stops
 * any other module from reaching `zones/infrastructure/zone.model.ts` directly
 * (docs/engineering/boundaries-and-enforcement.md).
 *
 * No parent lookup: Z-1 is retired (docs/LLD/zones.md) — a PICKUP zone is a flat serviceability
 * gate, not a sub-area of a city, and `parentZoneId` is always `null`.
 */
export class CreateZoneUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(input: CreateZoneInput, actor: ActorContext): Promise<Zone> {
    /**
     * The document-local half of Z-4. The Mongoose schema's `pre('validate')` hook checks this
     * too, but that throws a raw `Error` rather than an `AppError` — a caller that reaches it
     * gets an opaque 500 instead of a clean 400. Checking it here, before any I/O, is the real
     * answer; the schema hook stays as a last-resort backstop.
     */
    if (input.type === 'PICKUP' && !input.pickupChargeType) {
      throw AppError.badRequest('A PICKUP zone requires a charge type.', {
        field: 'pickup_charge_type',
      });
    }
    if (input.type !== 'PICKUP' && input.pickupChargeType) {
      throw AppError.badRequest(`A ${input.type} zone must not have a pickup charge.`, {
        field: 'pickup_charge_type',
      });
    }

    // MUST happen first — every check below, and the 2dsphere index itself, decides inside
    // from outside by ring winding (docs/LLD/zones.md §Four MongoDB behaviours).
    const geometry = normalizeWinding(input.geometry);

    const siblings = await this.zones.findSiblingsOfType(input.type);

    const violations = validateZone({ geom: geometry, siblings });
    if (violations.some((v) => v.severity === 'ERROR')) {
      throw zoneValidationFailed(violations);
    }

    const saved = await this.zones.save({
      type: input.type,
      name: input.name,
      code: input.code,
      parentZoneId: null,
      geometry,
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
