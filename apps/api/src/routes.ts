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
  /*
   * `/admin/drivers/:id/wallet`. Identity's ADMIN router owns `/admin/drivers` and
   * `/admin/drivers/:id`, neither of which matches three segments, so the request falls through to
   * here — the module that owns the ledger rows answers for them.
   */
  router.use('/admin/drivers', c.ledger.buildAdminRouter());
  router.use('/admin/reviews', c.reviews.buildAdminRouter());
  router.use('/coverage', c.zones.buildCoverageRouter());

  /**
   * Same overlapping-prefix fall-through as `/admin/zones` above, one tier down: a request to
   * `/customer/settings` enters identity's CUSTOMER router first, matches nothing, and arrives
   * here. Authenticated, not public — the cancellation ladder and the no-show timer are the app's
   * business, not an anonymous caller's.
   */
  router.use('/customer/settings', c.settings.buildAudienceRouter('CUSTOMER'));
  router.use('/driver/settings', c.settings.buildAudienceRouter('DRIVER'));

  /** Same fall-through again: these miss identity's role routers and land here. */
  router.use('/customer/quotes', c.quotes.buildCustomerRouter());
  router.use('/customer/bookings', c.bookings.buildCustomerRouter());
  router.use('/driver/bookings', c.bookings.buildDriverRouter());
  router.use('/admin/bookings', c.bookings.buildAdminRouter());
  router.use('/driver/offers', c.dispatch.buildDriverRouter());

  /*
   * `/{customer,driver}/bookings/:id/rate`, and the fall-through one level deeper than the mounts
   * above: the bookings routers own `/:id` and `/:id/cancel` and match neither, so the request
   * arrives here — the module that owns the review rows answers for it.
   *
   * Mounted on `/customer/bookings` rather than on `/customer`, which would sit in front of every
   * future `/customer/*` route in this file for the sake of one endpoint.
   */
  router.use('/customer/bookings', c.reviews.buildAudienceRouter('CUSTOMER'));
  router.use('/driver/bookings', c.reviews.buildAudienceRouter('DRIVER'));

  /**
   * The payment provider's callback. NOT under a role prefix and NOT behind `requireAuth` — the
   * caller is a gateway's server, which holds no session and belongs to no audience. It
   * authenticates with a signature over the raw request body instead, checked before anything
   * else happens.
   *
   * This is where a booking actually becomes CONFIRMED. The customer's app cannot do it, which is
   * the whole reason payment precedes confirmation rather than following it — so the callback
   * below is the one path from "paid" to "we are finding you a driver".
   */
  router.use(
    '/payments',
    c.payments.buildWebhookRouter(async (outcome) => {
      if (outcome.kind === 'CAPTURED') {
        await c.bookings.onPaymentCaptured(outcome.bookingId);
        return;
      }
      if (outcome.kind === 'FAILED') {
        await c.bookings.onPaymentFailed(outcome.bookingId, 'The payment was declined');
      }
      // A refund needs no booking-side action: the cancellation that caused it has already
      // transitioned the booking and recorded the fee.
    }),
  );

  return router;
}
