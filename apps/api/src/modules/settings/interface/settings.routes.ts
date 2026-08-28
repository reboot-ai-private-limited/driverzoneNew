import { Router, type RequestHandler } from 'express';
import type { Role } from '@driverzone/contracts';
import { requireAuth } from '@/shared/http/auth.middleware.js';

/**
 * INTERFACE — mounted in `apps/api/src/routes.ts`. The admin router sits at `/admin/settings`
 * alongside identity's `/admin` role router; the fall-through reasoning for the overlapping
 * prefix is documented at the `/admin/zones` mount.
 *
 * `requireAuth('ADMIN')` guards the whole admin surface rather than each route: every route here
 * reads or writes what the product charges, and there is none an admin should reach that a
 * non-admin should.
 *
 * `PATCH` rather than `PUT` on the update, and rather than a per-key route: the body is a sparse
 * map merged over what is stored, and the cross-key invariants are checked against the merged
 * result, so a single-key write is not a thing this module can offer safely.
 */
export interface AdminControllers {
  list: RequestHandler;
  update: RequestHandler;
  reset: RequestHandler;
}

export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));

  router.get('/', handlers.list);
  router.patch('/', handlers.update);
  router.post('/reset', handlers.reset);

  return router;
}

/**
 * The customer and driver read surfaces. Authenticated — these are not public: the fee ladder
 * tells anyone who reads it exactly what a cancellation costs and when the no-show timer fires,
 * which is the app's business and not an anonymous internet's.
 */
export function buildAudienceRouter(role: Role, handler: RequestHandler): Router {
  const router = Router();
  router.get('/', requireAuth(role), handler);
  return router;
}
