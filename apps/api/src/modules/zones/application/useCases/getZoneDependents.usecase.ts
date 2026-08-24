import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneNotFound } from '../../domain/zone.errors.js';

export interface ZoneDependents {
  childPickupZones: Zone[];
}

/**
 * APPLICATION — the blast radius, powering both `GET /admin/zones/:id/dependents` and the
 * deactivate-confirmation flow.
 * 
 * Zone-native dependents only. `catalog` and `bookings` don't exist yet, so "3 incity packages
 * reference this zone" / "8 scheduled bookings" (docs/LLD/admin-panel.md's example) can't be
 * computed here — `zones` sits below both in the tier graph and may not depend on either. Those
 * sections get added later by whichever module composes `zones` + `catalog` + `bookings`
 * (likely `admin`); the response shape is designed so adding them is additive, not breaking.
 */
export class GetZoneDependentsUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(zoneId: string): Promise<ZoneDependents> {
    const zone = await this.zones.findById(zoneId);
    if (zone === undefined) throw zoneNotFound();
    if (zone.type !== 'CITY') return { childPickupZones: [] };

    const childPickupZones = await this.zones.findChildren(zoneId);
    return { childPickupZones };
  }
}
