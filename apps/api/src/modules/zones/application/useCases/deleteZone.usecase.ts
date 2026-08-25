import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneNotFound, zoneStillActive } from '../../domain/zone.errors.js';

/**
 * APPLICATION — `DELETE /admin/zones/:id/hard`. Permanent, unlike `DeactivateZoneUseCase`
 * (`DELETE /admin/zones/:id`), which is reversible.
 *
 * Blocked unless the zone is already inactive — deactivate it first. That is the only gate left
 * to enforce: Z-1 is retired, so no zone can be another zone's parent any more, and there is
 * nothing else inside `zones` itself that could reference this row. Whether `catalog` (incity
 * packages, by `cityZoneId`) or `bookings` still hold history pointing at this id is not
 * something `zones` can see — it sits below both in the tier graph — so this cannot promise the
 * same completeness FR-Z6 originally described. It promises what this module can actually keep:
 * the row is gone, and there is an audit entry saying who removed it and when.
 */
export class DeleteZoneUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(zoneId: string, actor: ActorContext): Promise<void> {
    const zone = await this.zones.findById(zoneId);
    if (zone === undefined) throw zoneNotFound();
    if (zone.isActive) throw zoneStillActive(zoneId);

    await this.zones.deleteById(zoneId);

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Zone',
      entityId: zoneId,
      action: 'DELETE',
      before: { type: zone.type, name: zone.name, code: zone.code, version: zone.version },
      ip: actor.ip,
    });
  }
}
