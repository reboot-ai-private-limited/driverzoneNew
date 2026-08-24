import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { AdminControllers } from './admin.controller.js';

/**
 * INTERFACE — mounted at `/admin/zones` in `apps/api/src/routes.ts`, alongside (not instead of)
 * `identity`'s `/admin` role router. Express tries mounted routers in registration order and
 * falls through via `next()` when nothing inside one matches, so a more specific mount like this
 * one works regardless of which module happens to own the bare `/admin` prefix.
 */
export function buildAdminRouter(controllers: AdminControllers): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));

  router.get('/', controllers.list);
  router.post('/', controllers.create);
  router.post('/validate', controllers.validate);
  router.get('/:id', controllers.get);
  router.patch('/:id', controllers.updateGeometry);
  router.delete('/:id', controllers.delete);
  router.post('/:id/deactivate', controllers.deactivate);
  router.get('/:id/dependents', controllers.getDependents);

  return router;
}
