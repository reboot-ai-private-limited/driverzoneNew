import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneHasActiveDependents, zoneNotFound } from '../../domain/zone.errors.js';

/**
 * APPLICATION — the FR-Z6 hard block. Unlike `DeactivateZoneUseCase`, this destroys the row, so
 * there is no override: blocked while the zone is still active (deactivate it first) or while
 * anything still references it as a parent.
 */
export class DeleteZoneUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(zoneId: string, actor: ActorContext): Promise<void> {
    const zone = await this.zones.findById(zoneId);
    if (zone === undefined) throw zoneNotFound();

    if (zone.isActive) {
      throw zoneHasActiveDependents({
        reason: 'zone is still active — deactivate it before deleting',
      });
    }

    const children = await this.zones.findChildren(zoneId);
    if (children.length > 0) {
      throw zoneHasActiveDependents({
        child_pickup_zones: children.map((z) => ({ id: z.id, name: z.name })),
      });
    }

    await this.zones.deleteById(zoneId);

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Zone',
      entityId: zoneId,
      action: 'DELETE',
      before: { type: zone.type, name: zone.name, code: zone.code },
      ip: actor.ip,
    });
  }
}
