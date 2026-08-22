import type { Router } from 'express';
import { GetHealthUseCase } from './application/useCases/getHealth.usecase.js';
import type { HealthProbePort } from './domain/healthProbe.port.js';
import { MongoHealthProbe } from './infrastructure/mongoHealthProbe.adapter.js';
import { RedisHealthProbe } from './infrastructure/redisHealthProbe.adapter.js';
import { makeGetHealthController } from './interface/health.controller.js';
import { buildHealthRouter } from './interface/health.routes.js';
import type { HealthPublicContract } from './health.public.js';

/**
 * THE COMPOSITION ROOT for this module — the one file allowed to name concrete classes.
 *
 * Every layer above types against ports; this is where ports meet adapters. Because the wiring
 * is here and nowhere else, swapping an implementation is a one-line edit in one file, and
 * "what actually runs in production" has a single, greppable answer.
 *
 * It is also the answer to the honest cost of `.public.ts`: you cannot jump from a call site
 * to the implementation. You can always jump here.
 */
export interface HealthContainer {
  contract: HealthPublicContract;
  /**
   * Builds the HTTP surface — a FUNCTION, not a property, so constructing the module does not
   * construct its routes.
   *
   * The worker builds every container (it needs the same contracts the HTTP server does) and
   * serves nothing. With an eager `router` property it would allocate an Express router, its
   * middleware and its validation schemas for all thirteen modules, in a process with no
   * listener. Called only from `buildApiRouter`.
   */
  buildRouter: () => Router;
}

export function buildHealthContainer(): HealthContainer {
  const probes: HealthProbePort[] = [new MongoHealthProbe(), new RedisHealthProbe()];

  const getHealth = new GetHealthUseCase(probes);

  return {
    contract: {
      report: () => getHealth.execute(),
    },
    buildRouter: () => buildHealthRouter(makeGetHealthController(getHealth)),
  };
}
