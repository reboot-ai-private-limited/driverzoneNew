import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../../shared/http/auth.middleware.js';

export interface DriverControllers {
  list: RequestHandler;
  accept: RequestHandler;
  decline: RequestHandler;
}

export interface DriverScheduledBoardControllers {
  list: RequestHandler;
  accept: RequestHandler;
}

export interface AdminControllers {
  assignableDrivers: RequestHandler;
  assign: RequestHandler;
}

/**
 * Mounted at `/api/admin/bookings`, AHEAD of the bookings module's own admin router for the same
 * prefix — `routes.ts` explains why. Hence `/:id/assign` rather than `/bookings/:id/assign`.
 *
 * IT IS DISPATCH THAT ANSWERS FOR THESE despite the path saying bookings, because assigning a
 * driver writes `bookings.driverId` and this is the only module permitted to.
 *
 * MUST BE MOUNTED FIRST. The bookings admin router registers `GET /:id`, which reads
 * `assignable-drivers` as a booking id if it gets there first — this module used to be mounted
 * second, and that is exactly what happened: every request to this picker answered 404 "no such
 * booking", silently, because nothing but manual testing through the actual HTTP layer catches a
 * route-order bug like this one.
 */
export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/assignable-drivers', handlers.assignableDrivers);
  router.post('/:id/assign', handlers.assign);

  return router;
}

/** Mounted at `/api/driver/offers`. */
export function buildDriverRouter(handlers: DriverControllers): Router {
  const router = Router();
  router.use(requireAuth('DRIVER'));

  router.get('/', handlers.list);
  router.post('/:id/accept', handlers.accept);
  router.post('/:id/decline', handlers.decline);

  return router;
}

/**
 * Mounted at `/api/driver/scheduled-bookings` — the board of parked trips.
 *
 * ITS OWN ROUTER RATHER THAN MORE PATHS ON `/driver/offers`, because the two are different
 * things wearing similar words. An offer rings, expires and is scored; a board entry is browsed
 * and waits. Sharing a prefix would invite a client to treat one as the other.
 */
export function buildDriverScheduledBoardRouter(
  handlers: DriverScheduledBoardControllers,
): Router {
  const router = Router();
  router.use(requireAuth('DRIVER'));

  router.get('/', handlers.list);
  router.post('/:id/accept', handlers.accept);

  return router;
}
