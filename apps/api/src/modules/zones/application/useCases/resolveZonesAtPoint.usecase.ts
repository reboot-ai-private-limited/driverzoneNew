import { assertPlausibleCoordinate, toGeoJsonPoint, type LatLng } from '@driverzone/geo';
import type { ResolvedZones, Zone, ZoneType } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { ambiguousZoneMatch } from '../../domain/zone.errors.js';

/**
 * APPLICATION — point → zones. The single query every quote depends on
 * (docs/LLD/zone-resolution.md), wrapped with the one defensive check that still applies.
 *
 * `assertPlausibleCoordinate` runs first: a swapped lat/lng does not throw at the Mongo layer,
 * it silently resolves to a point in the Arabian Sea and reports "we don't serve your area" —
 * the single most common bug in this kind of system, per `@driverzone/geo`'s own header.
 *
 * There is no config-fault check for PICKUP any more — Z-1 is retired, a pickup zone has no
 * parent to disagree with (docs/decision-log.md, 2026-08-25).
 */
export class ResolveZonesAtPointUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(point: LatLng): Promise<ResolvedZones> {
    assertPlausibleCoordinate(point, 'point');

    const all = await this.zones.findContaining(toGeoJsonPoint(point));

    const city = this.oneOf(all, 'CITY');
    const hill = this.oneOf(all, 'HILL');
    const pickup = this.pickupMatch(all);

    return { city, pickup, hill, all };
  }

  /**
   * CITY and HILL: at most one active zone should ever contain a point (Z-2). More than one is
   * a violated invariant — "an alert, not a silent pick" (zone-resolution.md) — so this throws
   * rather than trusting `priority` to break the tie quietly.
   */
  private oneOf(zones: Zone[], type: ZoneType): Zone | null {
    const matches = zones.filter((z) => z.type === type);
    if (matches.length > 1) {
      throw ambiguousZoneMatch(
        matches.map((z) => z.id),
        type,
      );
    }
    return matches[0] ?? null;
  }

  /**
   * PICKUP is different: two pickup zones sharing an exact border is an *allowed* Z-2 outcome
   * (the 100 m² overlap tolerance), so a point exactly on a FREE/PAID boundary can legitimately
   * match both. `priority DESC` (already applied by the repository query) decides — and the
   * tiebreak must favour FREE, since silently overcharging on an ambiguity is far worse than
   * undercharging (docs/LLD/zones.md §Read path). That is an operational convention (draw the
   * FREE zone's priority higher), not something this code can enforce by itself.
   */
  private pickupMatch(zones: Zone[]): Zone | null {
    const matches = zones.filter((z) => z.type === 'PICKUP');
    return matches[0] ?? null;
  }
}
