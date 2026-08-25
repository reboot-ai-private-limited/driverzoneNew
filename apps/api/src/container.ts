import { buildHealthContainer } from '@/modules/health/health.container.js';
import { buildIdentityContainer } from '@/modules/identity/identity.container.js';
import { buildZonesContainer } from '@/modules/zones/zones.container.js';

/**
 * THE APPLICATION COMPOSITION ROOT.
 *
 * Every module container is built here, in dependency order, and the contracts they expose are
 * threaded into the modules that need them. As modules land this file grows into the readable
 * summary of the whole dependency graph — the tier list in `.dependency-cruiser.cjs` is the
 * machine-checked version of what this file does by hand.
 *
 * Build order must respect those tiers. A module cannot receive a contract that has not been
 * constructed yet, so if the wiring below ever needs to run backwards, the tiers are wrong.
 *
 * Separate from `routes.ts` on purpose. Both entrypoints need the modules; only one of them
 * serves HTTP. The worker imports this file and never touches Express.
 */
export interface AppContainers {
  health: ReturnType<typeof buildHealthContainer>;
  identity: ReturnType<typeof buildIdentityContainer>;
  zones: ReturnType<typeof buildZonesContainer>;
}

export function buildContainers(): AppContainers {
  // tier 0 — depends on no other module
  const health = buildHealthContainer();

  // tier 1 — customers, drivers, admins, auth
  const identity = buildIdentityContainer();

  // tier 3 — polygons, resolution, the invariant write guard
  const zones = buildZonesContainer();

  return { health, identity, zones };
}
