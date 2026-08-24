import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneListFilter, ZoneRepositoryPort } from '../../domain/zone.repository.port.js';

/** APPLICATION — the admin tree UI: filter by type/parent/active. */
export class ListZonesUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(filter: ZoneListFilter): Promise<Zone[]> {
    return this.zones.findMany(filter);
  }
}
