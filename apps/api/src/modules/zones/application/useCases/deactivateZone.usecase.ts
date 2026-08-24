import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneHasActiveDependents, zoneNotFound } from '../../domain/zone.errors.js';

export interface DeactivateZoneInput {
  /** The admin-panel.md "[Deactivate anyway]" override — proceeds despite active children. */
  force?: boolean | undefined;
}

/**
 * APPLICATION — the FR-Z6 / admin-panel.md "deactivate anyway" path.
 *
 * Reversible: a deactivated zone's history is never lost (it just stops being matched by
 * resolution), which is why this is the doc-10 blast-radius-and-confirm UX rather than the FR-Z6
 * hard block — that block is reserved for `DeleteZoneUseCase`, which actually destroys the row.
 *
 * Idempotent on an already-inactive zone: deactivating twice is a no-op success, not an error —
 * a double-submitted confirm button must not surface a false failure.
 */
export class DeactivateZoneUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(zoneId: string, input: DeactivateZoneInput, actor: ActorContext): Promise<Zone> {
    const zone = await this.zones.findById(zoneId);
    if (zone === undefined) throw zoneNotFound();
    if (!zone.isActive) return zone;

    // Only a CITY zone has PICKUP children to worry about — see `GetZoneDependentsUseCase`,
    // which answers the same question for the standalone `GET .../dependents` endpoint.
    const childPickupZones = zone.type === 'CITY' ? await this.zones.findChildren(zoneId) : [];
    if (childPickupZones.length > 0 && !input.force) {
      throw zoneHasActiveDependents({
        child_pickup_zones: childPickupZones.map((z) => ({ id: z.id, name: z.name })),
      });
    }

    await this.zones.setActive(zoneId, false);

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Zone',
      entityId: zoneId,
      action: 'UPDATE',
      before: { isActive: true },
      after: { isActive: false, forcedPastDependents: childPickupZones.length > 0 },
      ip: actor.ip,
    });

    const updated = await this.zones.findById(zoneId);
    if (updated === undefined) throw zoneNotFound();
    return updated;
  }
}
