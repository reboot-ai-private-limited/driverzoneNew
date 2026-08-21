import { Router } from 'express';
import { buildHealthContainer } from '@/modules/health/health.container.js';

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
 */
export interface AppContainers {
  health: ReturnType<typeof buildHealthContainer>;
}

export function buildContainers(): AppContainers {
  // tier 0 — depends on no other module
  const health = buildHealthContainer();

  return { health };
}

export function buildApiRouter(c: AppContainers): Router {
  const router = Router();
  router.use('/health', c.health.router);
  return router;
}
