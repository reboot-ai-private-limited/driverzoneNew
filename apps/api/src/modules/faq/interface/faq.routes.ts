import { Router, type RequestHandler } from 'express';
import type { Role } from '@driverzone/contracts';
import { requireAuth } from '@/shared/http/auth.middleware.js';

/**
 * INTERFACE — mounted in `apps/api/src/routes.ts`. The admin router sits at `/admin/faq` alongside
 * identity's `/admin` role router; the fall-through reasoning for the overlapping prefix is
 * documented at the `/admin/zones` mount.
 *
 * `PUT` rather than `PATCH`, and rather than per-row routes: the body is the whole list in the
 * order it should read, and it replaces what is stored. `domain/faq.repository.port.ts` explains
 * why a per-row surface is the wrong shape for content whose ordinary edit is a reorder.
 */
export interface AdminControllers {
  list: RequestHandler;
  replace: RequestHandler;
}

export function buildAdminRouter(handlers: AdminControllers): Router {
  const router = Router();

  router.use(requireAuth('ADMIN'));

  router.get('/', handlers.list);
  router.put('/', handlers.replace);

  return router;
}

/**
 * The customer and driver read surface. Authenticated, matching `settings.routes.ts` and every
 * other app-facing route in this API — the only unauthenticated route in the product is the
 * payment webhook, which is authenticated by signature instead.
 *
 * The consequence worth knowing: a signed-out user cannot read the FAQs. Both entry points today
 * (the account menu and the fare sheet's charge warning) are behind login, so nothing is lost yet.
 * The day the FAQs need to answer a question someone has BEFORE they sign up, this becomes the
 * first genuinely public content route in the codebase, and that is a decision to take
 * deliberately rather than by deleting a guard.
 */
export function buildAudienceRouter(role: Role, handler: RequestHandler): Router {
  const router = Router();
  router.get('/', requireAuth(role), handler);
  return router;
}
