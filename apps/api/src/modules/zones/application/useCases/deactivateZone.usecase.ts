import type { ActorContext } from '../actorContext.js';
import type { AuditPort } from '../../domain/audit.port.js';
import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneNotFound } from '../../domain/zone.errors.js';

/**
 * APPLICATION — `DELETE /admin/zones/:id`. Soft deactivate; there is no hard delete
 * (docs/LLD/zones.md §HTTP surface).
 *
 * Unconditionally allowed — there is nothing left to block on. Deactivating the last active
 * PICKUP zone, or the CITY zone, is permitted; `GetZoneDependentsUseCase` is where an admin
 * checks the blast radius *before* deciding, not a gate this use case enforces. That split
 * matters because zones cannot see `catalog`/`bookings` (tier 3, below both) to know what
 * actually depends on a zone — a hard block here would be a promise this module cannot keep.
 *
 * Idempotent: deactivating an already-inactive zone is a no-op success, not an error — a
 * double-submitted confirm button must not surface a false failure.
 */
export class DeactivateZoneUseCase {
  constructor(
    private readonly zones: ZoneRepositoryPort,
    private readonly audit: AuditPort,
  ) {}

  async execute(zoneId: string, actor: ActorContext): Promise<Zone> {
    const zone = await this.zones.findById(zoneId);
    if (zone === undefined) throw zoneNotFound();
    if (!zone.isActive) return zone;

    await this.zones.setActive(zoneId, false);

    await this.audit.record({
      adminId: actor.adminId,
      entityType: 'Zone',
      entityId: zoneId,
      action: 'UPDATE',
      before: { isActive: true },
      after: { isActive: false },
      ip: actor.ip,
    });

    const updated = await this.zones.findById(zoneId);
    if (updated === undefined) throw zoneNotFound();
    return updated;
  }
}
