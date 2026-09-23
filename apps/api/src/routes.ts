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
  router.use('/admin/faq', c.faq.buildAdminRouter());
  router.use('/admin/packages', c.packages.buildAdminRouter());
  /*
   * `GET /admin/quotes/explain` — which product a pair of coordinates resolves to, and why.
   *
   * In `quotes` rather than `packages` because answering it is the same composition quoting
   * performs (zones, then the road, then the package ladder), and `packages` sits below `zones`
   * and never sees a coordinate.
   */
  router.use('/admin/quotes', c.quotes.buildAdminRouter());
  /*
   * `/admin/drivers/:id/wallet`. Identity's ADMIN router owns `/admin/drivers` and
   * `/admin/drivers/:id`, neither of which matches three segments, so the request falls through to
   * here — the module that owns the ledger rows answers for them.
   */
  router.use('/admin/drivers', c.ledger.buildAdminRouter());
  /** `/admin/payouts` — manages settlements and disbursements to drivers. */
  router.use('/admin/payouts', c.ledger.buildPayoutRouter());
  /** `/admin/customers/:id/wallet`, by the same fall-through past identity's admin router. */
  router.use('/admin/customers', c.wallet.buildAdminRouter());
  router.use('/admin/reviews', c.reviews.buildAdminRouter());
  /*
   * The finance surface. Same prefix fall-through as the mounts above it: identity's `/admin`
   * role router has no `/finance` route, so it calls `next()` and the request lands here.
   */
  router.use('/admin/finance', c.admin.buildFinanceRouter());
  /*
   * Account deletion by a SUPER_ADMIN — `POST /admin/{customers|drivers}/:id/delete-account`. Same
   * fall-through as the wallet mounts above: nothing earlier on these prefixes matches that suffix.
   */
  router.use('/admin/customers', c.accounts.buildAdminRouter('CUSTOMER'));
  router.use('/admin/drivers', c.accounts.buildAdminRouter('DRIVER'));
  router.use('/coverage', c.zones.buildCoverageRouter());

  /*
   * Closing your own account from the app — `/{customer|driver}/account/deletion`. Identity's role
   * router has already required a token by the time a request falls through to here.
   */
  router.use('/customer/account', c.accounts.buildSelfRouter('CUSTOMER'));
  router.use('/driver/account', c.accounts.buildSelfRouter('DRIVER'));

  /*
   * The public deletion form. Its OWN prefix, not under `/customer`: identity's customer router
   * applies `requireAuth` to everything beneath it, so a public route there would answer 401 to
   * exactly the person it exists for — someone who has uninstalled and has no session.
   */
  router.use('/account-deletion', c.accounts.buildPublicRouter());

  /**
   * Same overlapping-prefix fall-through as `/admin/zones` above, one tier down: a request to
   * `/customer/settings` enters identity's CUSTOMER router first, matches nothing, and arrives
   * here. Authenticated, not public — the cancellation ladder and the no-show timer are the app's
   * business, not an anonymous caller's.
   */
  router.use('/customer/settings', c.settings.buildAudienceRouter('CUSTOMER'));
  router.use('/driver/settings', c.settings.buildAudienceRouter('DRIVER'));

  /**
   * The same published list to both, deliberately: an FAQ answers a question about a trip that a
   * customer and a driver are on together — most pointedly, who pays for the driver's food — and
   * two versions of that answer is the argument the FAQs exist to prevent.
   */
  router.use('/customer/faq', c.faq.buildAudienceRouter('CUSTOMER'));
  router.use('/driver/faq', c.faq.buildAudienceRouter('DRIVER'));

  /** Same fall-through again: these miss identity's role routers and land here. */
  router.use('/customer/quotes', c.quotes.buildCustomerRouter());
  router.use('/customer/wallet', c.wallet.buildCustomerRouter());
  /*
   * The drivers this customer wants rung first. A sibling of the mounts around it rather than
   * something hung off `/customer/bookings`: a favourite outlives any one trip, which is exactly
   * what makes it worth storing.
   */
  router.use('/customer/favourite-drivers', c.favourites.buildCustomerRouter());
  router.use('/customer/bookings', c.bookings.buildCustomerRouter());
  router.use('/driver/bookings', c.bookings.buildDriverRouter());
  /*
   * Manual assignment, on the same prefix as the bookings admin router below and mounted FIRST —
   * it has to be. The bookings router registers `GET /:id`, and Express matches routes in
   * registration order: mounted second, `GET /admin/bookings/assignable-drivers` would be read as
   * `GET /:id` with `id="assignable-drivers"` and answer 404 "no such booking" before dispatch's
   * own, more specific route ever saw the request — which is exactly what happened here until this
   * was caught by hand in Chrome, not by any test, because every existing test calls the use case
   * directly and never goes through Express routing at all. `POST /:id/assign` has no such
   * collision either way — the bookings router defines no route for that suffix — so this ordering
   * costs it nothing. It is `dispatch` that answers despite the path saying bookings, because
   * assigning a driver writes `bookings.driverId` and dispatch is the only module permitted to.
   */
  router.use('/admin/bookings', c.dispatch.buildAdminRouter());
  router.use('/admin/bookings', c.bookings.buildAdminRouter());
  router.use('/driver/offers', c.dispatch.buildDriverRouter());

  /*
   * The scheduled board — parked trips a driver can browse and take. Its own prefix rather than
   * more paths under `/driver/offers`, because an offer rings and expires while a board entry is
   * browsed and waits; sharing a prefix would invite a client to treat one as the other.
   */
  router.use('/driver/scheduled-bookings', c.dispatch.buildDriverScheduledBoardRouter());
  /** The driver's own earnings. Same rows, same mapper as `/admin/drivers/:id/wallet` above. */
  router.use('/driver/wallet', c.ledger.buildDriverRouter());

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
        // The payment id too: what a capture means to the booking depends on WHICH charge it
        // was — the fare, or the separate order collecting a day extension.
        await c.bookings.onPaymentCaptured(outcome.bookingId, outcome.paymentId);
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
