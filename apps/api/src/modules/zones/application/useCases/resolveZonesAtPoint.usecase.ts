import { assertPlausibleCoordinate, toGeoJsonPoint, type LatLng } from '@driverzone/geo';
import type { ResolvedZones, Zone, ZoneType } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { ambiguousZoneMatch, zoneConfigFault } from '../../domain/zone.errors.js';

/**
 * APPLICATION — point → zones. The single query every quote depends on
 * (docs/LLD/zone-resolution.md), wrapped with the two defensive checks the doc calls out.
 *
 * `assertPlausibleCoordinate` runs first: a swapped lat/lng does not throw at the Mongo layer,
 * it silently resolves to a point in the Arabian Sea and reports "we don't serve your area" —
 * the single most common bug in this kind of system, per `@driverzone/geo`'s own header.
 */
export class ResolveZonesAtPointUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(point: LatLng): Promise<ResolvedZones> {
    assertPlausibleCoordinate(point, 'point');

    const all = await this.zones.findContaining(toGeoJsonPoint(point));

    const city = this.oneOf(all, 'CITY');
    const pickup = this.oneOf(all, 'PICKUP');
    const hill = this.oneOf(all, 'HILL');

    /**
     * Steps 3–4 of the resolution algorithm: a PICKUP resolved whose parent is not the CITY
     * that independently also resolved at this same point. Should be structurally impossible if
     * Z-1 held at write time — a PICKUP fully inside its parent CITY means the parent CITY's
     * polygon covers this point too, whenever the PICKUP's does. Reachable only if Z-1 was
     * violated, or a zone edit drifted the geometry — hence a page, not a customer-facing error.
     */
    if (pickup && (city === null || pickup.parentZoneId !== city.id)) {
      throw zoneConfigFault(pickup.id, 'pickup zone resolved outside its parent city');
    }

    return { city, pickup, hill, all };
  }

  /**
   * At most one active zone per type should ever contain a point (Z-2). If more than one does,
   * that is a violated invariant — "an alert, not a silent pick" (zone-resolution.md), so this
   * throws rather than trusting `priority` to break the tie quietly.
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
}
