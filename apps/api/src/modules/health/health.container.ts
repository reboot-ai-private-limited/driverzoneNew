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
  router: Router;
  contract: HealthPublicContract;
}

export function buildHealthContainer(): HealthContainer {
  const probes: HealthProbePort[] = [new MongoHealthProbe(), new RedisHealthProbe()];

  const getHealth = new GetHealthUseCase(probes);

  return {
    router: buildHealthRouter(makeGetHealthController(getHealth)),
    contract: {
      report: () => getHealth.execute(),
    },
  };
}
