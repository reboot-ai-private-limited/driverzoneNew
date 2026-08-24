import {
  validateZone,
  zoneStats,
  type Polygon,
  type ZoneStats,
  type ZoneViolation,
} from '@driverzone/geo';
import { AppError } from '@/shared/errors/AppError.js';
import type { ZoneType } from '../../domain/zone.entity.js';
import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';

export interface ValidateZoneGeometryInput {
  type: ZoneType;
  parentZoneId?: string | undefined;
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
 * Backs both `POST /admin/zones/validate` and the live map-editor feedback
 * (docs/LLD/admin-panel.md §Live validation) — the same call this use case makes is what
 * `createZone`/`updateZoneGeometry` run for real, so a violation reported here can never
 * disagree with the one the write path would raise.
 */
export class ValidateZoneGeometryUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(input: ValidateZoneGeometryInput): Promise<ValidateZoneGeometryResult> {
    let parentGeom: Polygon | undefined;
    if (input.type === 'PICKUP') {
      if (!input.parentZoneId) {
        throw AppError.badRequest('A PICKUP zone requires a parent CITY zone.', {
          field: 'parent_zone_id',
        });
      }
      const parent = await this.zones.findById(input.parentZoneId);
      if (parent === undefined) {
        throw AppError.badRequest('Parent zone not found.', { field: 'parent_zone_id' });
      }
      parentGeom = parent.geometry;
    }

    const siblings = await this.zones.findSiblingsOfType(input.type, input.excludeZoneId);

    const violations = validateZone({
      geom: input.geometry,
      ...(parentGeom === undefined ? {} : { parentGeom }),
      siblings,
    });

    return {
      valid: !violations.some((v) => v.severity === 'ERROR'),
      violations,
      stats: zoneStats(input.geometry),
    };
  }
}
