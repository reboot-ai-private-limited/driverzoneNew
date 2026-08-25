import {
  normalizeWinding,
  validateZone,
  zoneStats,
  type Polygon,
  type ZoneStats,
  type ZoneViolation,
} from '@driverzone/geo';
import type { ZoneType } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';

export interface ValidateZoneGeometryInput {
  type: ZoneType;
  geometry: Polygon;
  /** Set when editing, so the zone is not checked against its own previous version (Z-2). */
  excludeZoneId?: string | undefined;
}

export interface ValidateZoneGeometryResult {
  valid: boolean;
  violations: ZoneViolation[];
  stats: ZoneStats;
}

/**
 * APPLICATION — dry run. Identical checks to `CreateZoneUseCase`, never persists.
 *
 * Backs both `POST /admin/zones/validate` — **always 200**, a violation is a valid answer, not
 * a 422 (docs/LLD/zones.md) — and the live map-editor feedback. The same call this use case
 * makes is what `createZone`/`updateZoneGeometry` run for real, so a violation reported here can
 * never disagree with the one the write path would raise.
 *
 * No parent lookup: Z-1 is retired, nothing supplies `parentGeom` any more.
 */
export class ValidateZoneGeometryUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(input: ValidateZoneGeometryInput): Promise<ValidateZoneGeometryResult> {
    const geometry = normalizeWinding(input.geometry);

    const siblings = await this.zones.findSiblingsOfType(input.type, input.excludeZoneId);

    const violations = validateZone({ geom: geometry, siblings });

    return {
      valid: !violations.some((v) => v.severity === 'ERROR'),
      violations,
      stats: zoneStats(geometry),
    };
  }
}
