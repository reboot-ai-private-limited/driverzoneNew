import { Router } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import type { AdminControllers } from './admin.controller.js';

/**
 * INTERFACE — mounted at `/admin/zones` in `apps/api/src/routes.ts`, alongside (not instead of)
 * `identity`'s `/admin` role router. Express tries mounted routers in registration order and
 * falls through via `next()` when nothing inside one matches, so a more specific mount like this
 * one works regardless of which module happens to own the bare `/admin` prefix.
 *
 * Geometry gets its own route rather than an overloaded `PATCH /:id` — the two operations have
 * different semantics (one versions, one does not), different failure modes, and different
 * audit payloads. Two separate delete verbs for the same reason: `DELETE /:id` is soft and
 * reversible (blocks on nothing); `DELETE /:id/hard` is permanent and blocked unless the zone is
 * already inactive. Same HTTP method, different resources, so no ambiguity at the router level.
 */
export function buildAdminRouter(controllers: AdminControllers): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));

  router.get('/', controllers.list);
  router.post('/', controllers.create);
  router.post('/validate', controllers.validate);
  router.get('/:id', controllers.get);
  router.patch('/:id', controllers.updateMetadata);
  router.patch('/:id/geometry', controllers.updateGeometry);
  router.delete('/:id/hard', controllers.delete);
  router.delete('/:id', controllers.deactivate);
  router.get('/:id/dependents', controllers.getDependents);

  return router;
}
