import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneNotFound } from '../../domain/zone.errors.js';

/** APPLICATION — a single zone by id, for the admin detail panel. */
export class GetZoneUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(zoneId: string): Promise<Zone> {
    const zone = await this.zones.findById(zoneId);
    if (zone === undefined) throw zoneNotFound();
    return zone;
  }
}
