import { DEV_ZONES } from '@/config/devZones.js';
import type { ZonesPublicContract } from '@/modules/zones/zones.public.js';

export type ZoneSeedOutcome = Map<string, 'created' | 'present'>;

/**
 * Creates every zone in `DEV_ZONES` that is not already active, attributed to `adminId`.
 *
 * Shared by `seed.ts` (the dev admin) and `bootstrap.ts` (a real production admin). Skips by
 * `code` rather than overwriting, so a polygon an admin has since reshaped in the editor survives
 * a rerun of either script.
 */
export async function seedZones(zones: ZonesPublicContract, adminId: string): Promise<ZoneSeedOutcome> {
  const actor = { adminId };

  // One query, not one per zone. Active-only is the right filter: a superseded version keeps its
  // code, and the partial unique index means only the active one can block a create.
  const existing = new Set((await zones.list({ isActive: true })).map((z) => z.code));

  const outcome: ZoneSeedOutcome = new Map();

  for (const zone of DEV_ZONES) {
    if (existing.has(zone.code)) {
      outcome.set(zone.code, 'present');
      continue;
    }

    await zones.create(
      {
        type: zone.type,
        name: zone.name,
        code: zone.code,
        geometry: zone.geometry,
        pickupChargeType: zone.pickupChargeType,
        pickupChargePaise: zone.pickupChargePaise,
      },
      actor,
    );
    outcome.set(zone.code, 'created');
  }

  return outcome;
}
