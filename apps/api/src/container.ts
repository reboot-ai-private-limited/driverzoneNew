import { buildHealthContainer } from '@/modules/health/health.container.js';
import { buildIdentityContainer } from '@/modules/identity/identity.container.js';
import { buildPackagesContainer } from '@/modules/packages/packages.container.js';
import { buildSettingsContainer } from '@/modules/settings/settings.container.js';
import { buildZonesContainer } from '@/modules/zones/zones.container.js';
import { buildReviewsContainer } from '@/modules/reviews/reviews.container.js';

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
  settings: ReturnType<typeof buildSettingsContainer>;
  identity: ReturnType<typeof buildIdentityContainer>;
  zones: ReturnType<typeof buildZonesContainer>;
  packages: ReturnType<typeof buildPackagesContainer>;
  reviews: ReturnType<typeof buildReviewsContainer>;
}

export function buildContainers(): AppContainers {
  // tier 0 — depends on no other module
  const health = buildHealthContainer();
  /**
   * Also tier 0. Its contract is not threaded anywhere yet, deliberately: the TODOs that will
   * consume it (`packages/application/useCases/resolveForTrip.usecase.ts`,
   * `zones/domain/zone.entity.ts`) reference keys this pass does not define, and a contract wired
   * into a module that ignores it reads like a dependency that exists.
   */
  const settings = buildSettingsContainer();

  // tier 1 — customers, drivers, admins, auth
  const identity = buildIdentityContainer();

  // tier 3 — polygons, resolution, the invariant write guard
  const zones = buildZonesContainer();

  // tier 4 — incity + outstation package definitions
  const packages = buildPackagesContainer();

  // tier 5 — post-trip reviews and ratings
  const reviews = buildReviewsContainer(settings.contract);

  return { health, settings, identity, zones, packages, reviews };
}
