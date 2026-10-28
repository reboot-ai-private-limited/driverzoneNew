import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { AdminInvoicesControllers, CustomerInvoicesControllers } from './invoices.controller.js';

/**
 * Mounted at `/api/customer/bookings`, behind the bookings and reviews routers for the same prefix
 * — `routes.ts` explains the fall-through. Hence `/:id/gst-invoice`.
 */
export function buildCustomerInvoicesRouter(controllers: CustomerInvoicesControllers): Router {
  const router = Router();
  router.use(requireAuth('CUSTOMER'));

  router.get('/:id/gst-invoice', controllers.getForTrip);
  router.post('/:id/gst-invoice', controllers.request);

  return router;
}

/** Mounted at `/api/admin/gst-invoices`. */
export function buildAdminInvoicesRouter(controllers: AdminInvoicesControllers): Router {
  const router = Router();
  router.use(requireAuth('ADMIN'));

  router.get('/', controllers.list);
  router.patch('/:id', controllers.resolve);

  return router;
}
