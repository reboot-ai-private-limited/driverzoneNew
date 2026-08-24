import { Router } from 'express';
import type { AppContainers } from './container.js';

/**
 * The HTTP half of composition: which module answers on which path.
 *
 * Takes containers already built by `container.ts` rather than building them, so this file has
 * one job and the worker can construct the same modules without importing it.
 */
export function buildApiRouter(c: AppContainers): Router {
  const router = Router();
  router.use('/health', c.health.buildRouter());

  /**
   * One auth surface per role, each with its own JWT audience.
   *
   * Mounted separately rather than as a single `/auth` with a role in the body: the path IS the
   * role, so a caller cannot request one, and the admin cookie can be scoped to
   * `/api/admin/auth` alone rather than riding along on every request the mobile apps make.
   */
  router.use('/customer/auth', c.identity.buildAuthRouter('CUSTOMER'));
  router.use('/driver/auth', c.identity.buildAuthRouter('DRIVER'));
  router.use('/admin/auth', c.identity.buildAuthRouter('ADMIN'));

  return router;
}
