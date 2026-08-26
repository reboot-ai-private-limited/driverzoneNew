import { Router, type RequestHandler } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';

/**
 * INTERFACE — mounted at `/admin/packages` in `apps/api/src/routes.ts`, alongside (not instead
 * of) identity's `/admin` role router, exactly as `zones/interface/admin.routes.ts` is. The
 * fall-through reasoning for the overlapping prefix is documented at that mount point.
 *
 * `requireAuth('ADMIN')` guards the whole surface rather than each route, because there is no
 * route here that anyone but an admin may reach: every one of them reads or writes what the
 * product costs. Pricing is not public data, and an unguarded `PUT /outstation/:id` is a
 * stranger setting our fares.
 *
 * `PUT` rather than `PATCH` on the updates: the handlers replace the nested `variants`/`prices`
 * arrays wholesale rather than merging into them, so the verb matches the semantics. See the
 * TODO in `updateIncityPackage.usecase.ts` about the subdocument ids that costs.
 */
export interface AdminControllers {
  createIncity: RequestHandler;
  listIncity: RequestHandler;
  getIncity: RequestHandler;
  updateIncity: RequestHandler;
  createOutstation: RequestHandler;
  listOutstation: RequestHandler;
  getOutstation: RequestHandler;
  updateOutstation: RequestHandler;
}

export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));

  router.post('/incity', handlers.createIncity);
  router.get('/incity', handlers.listIncity);
  router.get('/incity/:id', handlers.getIncity);
  router.put('/incity/:id', handlers.updateIncity);

  router.post('/outstation', handlers.createOutstation);
  router.get('/outstation', handlers.listOutstation);
  router.get('/outstation/:id', handlers.getOutstation);
  router.put('/outstation/:id', handlers.updateOutstation);

  return router;
}
