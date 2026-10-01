import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';

export interface CustomerControllers {
  create: RequestHandler;
  list: RequestHandler;
  dues: RequestHandler;
  /** `GET /customer/bookings/current` — the booking-recovery read, start OTP included. */
  current: RequestHandler;
  get: RequestHandler;
  cancel: RequestHandler;
  /** `POST /customer/bookings/:id/extend` — asks the driver for one more day. */
  extend: RequestHandler;
  /** `POST /customer/bookings/:id/payment-method` — selects payment method once STARTED. */
  selectPaymentMethod: RequestHandler;
  /** `POST /customer/bookings/:id/payment/verify` — confirms a checkout instantly, ahead of the webhook. */
  verifyPayment: RequestHandler;
  /** `POST /customer/bookings/:id/extras/pay` — a checkout for an accepted extra day. */
  payExtras: RequestHandler;
  /** `POST /customer/bookings/:id/extras/verify` — the same accelerant, for that order. */
  verifyExtrasPayment: RequestHandler;
}

export interface DriverControllers {
  /** `GET /driver/bookings` — this driver's own trip history. */
  list: RequestHandler;
  /** `GET /driver/bookings/current` — the trip-recovery read. */
  current: RequestHandler;
  get: RequestHandler;
  enRoute: RequestHandler;
  arrived: RequestHandler;
  reportPin: RequestHandler;
  start: RequestHandler;
  complete: RequestHandler;
  cancel: RequestHandler;
  acceptExtension: RequestHandler;
  declineExtension: RequestHandler;
  /** `POST /driver/bookings/:id/switch-to-cash` — the fallback when the customer cannot pay online. */
  switchToCash: RequestHandler;
  /** `POST /driver/bookings/:id/extras/cash` — the extra day was handed over in cash. */
  collectExtrasInCash: RequestHandler;
}

export interface AdminControllers {
  /** `POST /admin/bookings` — book a trip for a customer from the panel. Manual dispatch. */
  create: RequestHandler;
  /** `POST /admin/bookings/:id/auto-dispatch` — hand a manual booking to automatic dispatch. */
  enableAutoDispatch: RequestHandler;
  list: RequestHandler;
  get: RequestHandler;
  events: RequestHandler;
  forceArrive: RequestHandler;
  cancel: RequestHandler;
}

/** Mounted at `/api/customer/bookings`. */
export function buildCustomerRouter(handlers: CustomerControllers): Router {
  const router = Router();
  router.use(requireAuth('CUSTOMER'));

  router.post('/', handlers.create);
  router.get('/', handlers.list);
  // BEFORE `/:id`, or Express reads these as booking ids and answers 404.
  router.get('/dues', handlers.dues);
  router.get('/current', handlers.current);
  router.get('/:id', handlers.get);
  router.post('/:id/cancel', handlers.cancel);
  /* Buying one more day on an outstation trip already under way. The driver has to agree — see
     `extendBooking.usecase.ts` — so this opens a request rather than charging anything. */
  router.post('/:id/extend', handlers.extend);
  router.post('/:id/payment-method', handlers.selectPaymentMethod);
  /* The app's own checkout result, signature and all. Confirms sooner than the webhook would, and
     verifies that signature server-side rather than taking the client's word — see
     `VerifyCheckoutUseCase`. */
  router.post('/:id/payment/verify', handlers.verifyPayment);
  /* The extra day, collected on its own order. Separate from `/payment-method` because the
     booking's order was raised — usually paid — before the extra day existed, and a gateway order
     cannot be repriced once its id is in a customer's hands. See `payExtras.usecase.ts`. */
  router.post('/:id/extras/pay', handlers.payExtras);
  router.post('/:id/extras/verify', handlers.verifyExtrasPayment);

  return router;
}

/**
 * Mounted at `/api/driver/bookings`.
 *
 * The order of these is the trip: on the way, arrived, started, complete. `pin-report` sits
 * beside `arrived` because it is what a driver reaches for when that one refuses them.
 */
export function buildDriverRouter(handlers: DriverControllers): Router {
  const router = Router();
  router.use(requireAuth('DRIVER'));

  /*
   * BEFORE `/:id`, or `current` is read as a booking id and answers 404 — the same ordering trap
   * the customer router's `/dues` and the dispatch router's `/current` both carry a note about.
   */
  router.get('/', handlers.list);
  router.get('/current', handlers.current);
  router.get('/:id', handlers.get);
  router.post('/:id/en-route', handlers.enRoute);
  router.post('/:id/arrived', handlers.arrived);
  router.post('/:id/pin-report', handlers.reportPin);
  router.post('/:id/start', handlers.start);
  router.post('/:id/complete', handlers.complete);
  router.post('/:id/cancel', handlers.cancel);
  /* The driver's answer to a day extension. Two URLs rather than a body flag, so a yes and a no
     cannot be produced by the same malformed request. */
  router.post('/:id/extension/accept', handlers.acceptExtension);
  router.post('/:id/extension/decline', handlers.declineExtension);
  /* The way out of the payment gate when the customer's own app cannot get there — a dead phone,
     no signal — and they pay the driver in cash instead. */
  router.post('/:id/switch-to-cash', handlers.switchToCash);
  /* The narrow version of the line above, for a trip whose FARE was already paid online and so
     cannot be switched wholesale — only the extra day moves. See `CollectExtrasInCashUseCase`. */
  router.post('/:id/extras/cash', handlers.collectExtrasInCash);

  return router;
}

/** Mounted at `/api/admin/bookings`. */
export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/', handlers.list);
  router.post('/', handlers.create);
  router.get('/:id', handlers.get);
  router.get('/:id/events', handlers.events);
  router.post('/:id/force-arrive', handlers.forceArrive);
  /*
   * Ops killing a trip. Charges nobody — see `CancelBookingByAdminUseCase` — which is why it does
   * not share a handler with the customer's cancel despite taking the identical body.
   */
  router.post('/:id/cancel', handlers.cancel);
  router.post('/:id/auto-dispatch', handlers.enableAutoDispatch);

  return router;
}
