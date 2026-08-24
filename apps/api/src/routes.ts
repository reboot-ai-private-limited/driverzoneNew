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
   * One surface per role — auth plus that role's own account routes.
   *
   * The path IS the role, rather than a role field in a body a caller could set. That also lets
   * the admin refresh cookie be scoped to `/api/admin/auth` alone instead of riding along on
   * every request the mobile apps make.
   *
   * Each role's routes are composed inside its container, so this list stays at three entries
   * however many endpoints the module grows.
   */
  router.use('/customer', c.identity.buildRoleRouter('CUSTOMER'));
  router.use('/driver', c.identity.buildRoleRouter('DRIVER'));
  router.use('/admin', c.identity.buildRoleRouter('ADMIN'));

  return router;
}
