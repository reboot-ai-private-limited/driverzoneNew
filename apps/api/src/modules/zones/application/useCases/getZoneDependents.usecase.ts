import type { ZoneRepositoryPort } from '../../domain/zone.repository.port.js';
import { zoneNotFound } from '../../domain/zone.errors.js';

export interface ZoneDependents {
  /** Human-readable blast-radius warnings, shown before an admin deactivates. Empty if none. */
  warnings: string[];
}

/**
 * APPLICATION — the blast radius, shown before deactivating (`GET /admin/zones/:id/dependents`).
 * Informational only — deactivation is never blocked (`DeactivateZoneUseCase`); this is what an
 * admin checks *before* deciding, not a gate.
 *
 * PICKUP: computed for real — "is this the last active pickup zone" is a question `zones` can
 * answer on its own. CITY: the incity-packages warning is a fixed message, not a real count —
 * `zones` sits below `packages` in the tier graph and may not depend on it. A real count is
 * computed by whichever module composes `zones` + `packages` (likely `admin`); this message is
 * designed to be replaced, not built around.
 */
export class GetZoneDependentsUseCase {
  constructor(private readonly zones: ZoneRepositoryPort) {}

  async execute(zoneId: string): Promise<ZoneDependents> {
    const zone = await this.zones.findById(zoneId);
    if (zone === undefined) throw zoneNotFound();

    const warnings: string[] = [];

    if (zone.type === 'PICKUP') {
      const activePickups = await this.zones.findMany({ type: 'PICKUP', isActive: true });
      const isLastOne = activePickups.length === 1 && activePickups[0]?.id === zone.id;
      if (isLastOne) warnings.push('All service stops — this is the only active pickup zone.');
    }

    if (zone.type === 'CITY') {
      warnings.push(
        'Incity packages for this city will stop being sellable. Outstation keeps working.',
      );
    }

    return { warnings };
  }
}
