import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { FavouritesControllers } from './favourites.controller.js';

/**
 * Mounted at `/api/customer/favourite-drivers`.
 *
 * `requireAuth('CUSTOMER')` is applied once at the router rather than per route, for the same
 * reason `customer.routes.ts` does it: applied per route it is a line somebody eventually forgets
 * to copy onto the next endpoint, and a forgotten one here is an unauthenticated write to
 * somebody else's favourites.
 *
 * THE DRIVER ID IS IN THE PATH ON DELETE AND IN THE BODY ON POST. That asymmetry is deliberate:
 * a DELETE has no body to speak of, and a POST that creates a row should carry what it is
 * creating. Both are `driver_id`/`driverId` for the same driver.
 */
export function buildFavouritesRouter(controllers: FavouritesControllers): Router {
  const router = Router();

  router.use(requireAuth('CUSTOMER'));

  router.get('/', controllers.list);
  router.post('/', controllers.add);
  router.delete('/:driverId', controllers.remove);

  return router;
}
