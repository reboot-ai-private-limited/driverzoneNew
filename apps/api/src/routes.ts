import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { isProduction } from '@/config/env.js';
import { generateOpenApiDocument } from '@/shared/http/swagger.util.js';
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
   * Zones and settings — the modules that register OpenAPI paths so far
   * (each container calls its own `register*SwaggerPaths()` as a side effect of being
   * built, which has already happened by the time this function runs — `c` is built first). The
   * document is generated once per process start, not per request: nothing here changes without
   * a redeploy.
   *
   * Off in production. This is generated straight from the same validators the API enforces
   * requests with, which is exactly why it is not something to hand an unauthenticated internet
   * a map of by default.
   */
  if (!isProduction) {
    const openApiDocument = generateOpenApiDocument();
    router.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));
  }

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

  /**
   * More specific than `/admin` above, so they must be registered after it: a request to
   * `/admin/zones/...` first enters identity's ADMIN router, finds no matching route inside it,
   * and falls through via `next()` to this mount — standard Express behaviour for two `.use()`
   * calls with overlapping prefixes, not a hack. `/coverage` has no such overlap.
   */
  router.use('/admin/zones', c.zones.buildAdminRouter());
  router.use('/admin/settings', c.settings.buildAdminRouter());
  router.use('/admin/packages', c.packages.buildAdminRouter());
  router.use('/admin/reviews', c.reviews.buildAdminRouter());
  router.use('/coverage', c.zones.buildCoverageRouter());

  /**
   * Same overlapping-prefix fall-through as `/admin/zones` above, one tier down: a request to
   * `/customer/settings` enters identity's CUSTOMER router first, matches nothing, and arrives
   * here. Authenticated, not public — the cancellation ladder and the no-show timer are the app's
   * business, not an anonymous caller's.
   */
  router.use('/customer/settings', c.settings.buildAudienceRouter('CUSTOMER'));
  router.use('/customer', c.reviews.buildAudienceRouter('CUSTOMER'));
  router.use('/driver/settings', c.settings.buildAudienceRouter('DRIVER'));
  router.use('/driver', c.reviews.buildAudienceRouter('DRIVER'));

  return router;
}
