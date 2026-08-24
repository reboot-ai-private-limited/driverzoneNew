import type { LatLng } from '@driverzone/geo';
import type { Zone } from '../../domain/zone.entity.js';
import type { ResolveZonesAtPointUseCase } from './resolveZonesAtPoint.usecase.js';

export interface CoverageCheckResult {
  covered: boolean;
  city: Zone | null;
  pickup: Zone | null;
}

/**
 * APPLICATION — the pre-flight `GET /coverage/check`, before a customer has typed a destination
 * (docs/LLD/api-contracts.md).
 *
 * Composes `ResolveZonesAtPointUseCase` directly rather than depending on `ZoneRepositoryPort`
 * and re-deriving the resolution query — unlike the other use cases in this module, which depend
 * only on ports. Re-implementing the resolution algorithm a second time, even trivially, is a
 * bigger risk than the one use-case-depends-on-use-case coupling this introduces: it's exactly
 * the kind of duplication that lets a fix to one copy silently not apply to the other.
 */
export class CheckCoverageUseCase {
  constructor(private readonly resolve: ResolveZonesAtPointUseCase) {}

  async execute(point: LatLng): Promise<CoverageCheckResult> {
    const resolved = await this.resolve.execute(point);
    return { covered: resolved.pickup !== null, city: resolved.city, pickup: resolved.pickup };
  }
}