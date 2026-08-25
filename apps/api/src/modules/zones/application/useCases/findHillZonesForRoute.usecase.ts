import type { LineString } from '@driverzone/geo';
import type { Zone } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';

/**
 * APPLICATION — which HILL zones a route touches. **DORMANT: nothing calls this.**
 *
 * Terrain is now decided by whether the DROP POINT falls inside a HILL zone — a field read off
 * `resolveAt(to).hill`, the query that already runs (docs/LLD/packages.md §Terrain). No route is
 * measured, so `packages` needs nothing from this method.
 *
 * Kept alongside `classifyTerrain()` in `@driverzone/geo`, which is dormant for the same reason,
 * so reviving route-based classification is a wiring change rather than a rewrite. The trigger is
 * drivers reporting specific routes as underpaid. See docs/decision-log.md.
 *
 * The original note still holds if it is ever revived: geometry only, no verdict and no
 * threshold, so this module never needs `settings`. The caller would run `classifyTerrain()`
 * itself against the zones this returns.
 */
export class FindHillZonesForRouteUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(route: LineString): Promise<Zone[]> {
    return this.zones.findHillZonesIntersecting(route);
  }
}
