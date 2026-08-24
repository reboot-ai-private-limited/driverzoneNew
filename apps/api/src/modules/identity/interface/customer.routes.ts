import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { CustomerControllers } from './customer.controller.js';

/**
 * INTERFACE — the customer's own account surface.
 *
 * `requireAuth('CUSTOMER')` is applied once at the router rather than per route. Applied
 * per-route it is a line somebody eventually forgets to copy when adding the next endpoint, and
 * a forgotten one here is an unauthenticated profile read.
 */
export function buildCustomerRouter(controllers: CustomerControllers): Router {
  const router = Router();

  router.use(requireAuth('CUSTOMER'));

  router.get('/profile', controllers.getProfile);
  router.patch('/profile', controllers.updateProfile);

  router.post('/addresses', controllers.addAddress);
  router.patch('/addresses/:id', controllers.updateAddress);
  router.delete('/addresses/:id', controllers.removeAddress);

  router.post('/vehicles', controllers.addVehicle);
  router.patch('/vehicles/:id', controllers.updateVehicle);
  router.delete('/vehicles/:id', controllers.removeVehicle);

  return router;
}
