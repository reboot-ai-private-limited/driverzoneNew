import { Router } from 'express';
import type { CustomerControllers } from './customer.controller.js';

/** INTERFACE — mounted at `/coverage` in `apps/api/src/routes.ts`. Unauthenticated. */
export function buildCoverageRouter(controllers: CustomerControllers): Router {
  const router = Router();
  router.get('/check', controllers.checkCoverage);
  return router;
}
