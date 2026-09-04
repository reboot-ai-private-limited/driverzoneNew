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
}

export interface DriverControllers {
  /** `GET /driver/bookings/current` — the trip-recovery read. */
  current: RequestHandler;
  get: RequestHandler;
  enRoute: RequestHandler;
  arrived: RequestHandler;
  reportPin: RequestHandler;
  start: RequestHandler;
  complete: RequestHandler;
  cancel: RequestHandler;
}

export interface AdminControllers {
  events: RequestHandler;
  forceArrive: RequestHandler;
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
  router.get('/current', handlers.current);
  router.get('/:id', handlers.get);
  router.post('/:id/en-route', handlers.enRoute);
  router.post('/:id/arrived', handlers.arrived);
  router.post('/:id/pin-report', handlers.reportPin);
  router.post('/:id/start', handlers.start);
  router.post('/:id/complete', handlers.complete);
  router.post('/:id/cancel', handlers.cancel);

  return router;
}

/** Mounted at `/api/admin/bookings`. */
export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/:id/events', handlers.events);
  router.post('/:id/force-arrive', handlers.forceArrive);

  return router;
}
