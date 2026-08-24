import type { LineString } from '@driverzone/geo';
import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';

/**
 * APPLICATION — which HILL zones a route touches. Geometry only, no terrain classification and
 * no threshold: `findHillZonesNear` on `ZoneResolutionContract` returns `Zone[]`, not a
 * PLAIN/HILL verdict, so this module never needs `settings` (which does not exist yet). Whichever
 * future module calls this (`quotes`) runs `classifyTerrain()` from `@driverzone/geo` itself,
 * with its own threshold, against the zones this returns.
 */
export class FindHillZonesForRouteUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(route: LineString): Promise<Zone[]> {
    return this.zones.findHillZonesIntersecting(route);
  }
}
