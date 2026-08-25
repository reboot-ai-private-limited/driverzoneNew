import { AppError } from '@/shared/errors/AppError.js';
import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { PickupChargeType, Zone } from '../../domain/zone.entity.js';
import type { ZoneMetadataPatch, ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneCodeInUse, zoneNotFound } from '../../domain/zone.errors.js';

export interface UpdateZoneMetadataInput {
  name?: string | undefined;
  code?: string | undefined;
  priority?: number | undefined;
  pickupChargeType?: PickupChargeType | null | undefined;
  pickupChargePaise?: number | null | undefined;
}

/**
 * APPLICATION — name, code, priority, pickup charge. Never geometry, never `version` — that is
 * `UpdateZoneGeometryUseCase`'s job, deliberately kept separate (docs/LLD/zones.md: "the two
 * operations have different semantics, different failure modes, and different audit payloads").
 */
export class UpdateZoneMetadataUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(zoneId: string, input: UpdateZoneMetadataInput, actor: ActorContext): Promise<Zone> {
    const before = await this.zones.findById(zoneId);
    if (before === undefined) throw zoneNotFound();

    if (input.code !== undefined && input.code !== before.code) {
      const existing = await this.zones.findByCode(input.code);
      if (existing !== undefined && existing.id !== zoneId) throw zoneCodeInUse(input.code);
    }

    /**
     * The document-local half of Z-4 ("PICKUP requires a charge type") only runs on
     * `.save()`/`.create()` in Mongoose — `pre('validate')` is document middleware and does not
     * fire for `findByIdAndUpdate`, so this update path is the only place left to enforce it.
     */
    if (before.type === 'PICKUP' && input.pickupChargeType === null) {
      throw AppError.badRequest('A PICKUP zone requires a charge type.', {
        field: 'pickup_charge_type',
      });
    }
    if (before.type !== 'PICKUP' && input.pickupChargeType !== undefined && input.pickupChargeType !== null) {
      throw AppError.badRequest(`A ${before.type} zone must not have a pickup charge.`, {
        field: 'pickup_charge_type',
      });
    }

    const patch: ZoneMetadataPatch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.pickupChargeType === undefined ? {} : { pickupChargeType: input.pickupChargeType }),
      ...(input.pickupChargePaise === undefined ? {} : { pickupChargePaise: input.pickupChargePaise }),
    };

    const after = await this.zones.updateMetadata(zoneId, patch);
    if (after === undefined) throw zoneNotFound();

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Zone',
      entityId: zoneId,
      action: 'UPDATE',
      before: {
        name: before.name,
        code: before.code,
        priority: before.priority,
        pickupChargeType: before.pickupChargeType,
        pickupChargePaise: before.pickupChargePaise,
      },
      after: {
        name: after.name,
        code: after.code,
        priority: after.priority,
        pickupChargeType: after.pickupChargeType,
        pickupChargePaise: after.pickupChargePaise,
      },
      ip: actor.ip,
    });

    return after;
  }
}
