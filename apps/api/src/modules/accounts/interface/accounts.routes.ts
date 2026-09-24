import { Router, type RequestHandler } from 'express';
import { requireAuth } from '@/shared/http/auth.middleware.js';
import { rateLimitMiddleware } from '@/shared/http/rateLimit.middleware.js';
import type { ClosableRole } from '../../identity/identity.public.js';
import type {
  PublicDeletionControllers,
  SelfDeletionControllers,
} from './accounts.controller.js';

/**
 * INTERFACE — the three ways an account is closed. See `DeleteAccountUseCase` for how their rules
 * differ; this file only decides who may reach each one.
 */

/** Mounted at `/{customer|driver}/account`. `requireAuth` again: see the note in routes.ts. */
export function buildSelfDeletionRouter(role: ClosableRole, c: SelfDeletionControllers): Router {
  const router = Router();
  router.use(requireAuth(role));

  router.get('/deletion', c.preview);
  router.post('/deletion/otp', c.requestCode);
  router.post('/deletion', c.confirm);

  return router;
}

/**
 * Mounted at `/account-deletion`. NO SESSION — this is the page Google Play requires to work for
 * someone who has already uninstalled.
 *
 * The same blunt per-IP limiter as the login routes, on its own budget. It is the outer layer;
 * the per-phone and per-IP hourly caps inside the OTP sender are the ones that actually bound how
 * many texts this can make us send.
 */
export function buildPublicDeletionRouter(c: PublicDeletionControllers): Router {
  const router = Router();

  const flood = rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 20,
    prefix: 'account-deletion',
    message: 'Too many attempts from this connection. Please try again shortly.',
  });

  router.post('/:role/otp', flood, c.requestCode);
  router.post('/:role/confirm', flood, c.confirm);

  return router;
}

/**
 * Mounted at `/admin/customers` and `/admin/drivers`, falling through identity's admin router.
 * Guarded route by route rather than with `router.use`, so the super-admin lookup runs only for
 * this route and not for every other request that passes through the same prefix.
 */
export function buildAdminDeletionRouter(
  closeAccount: RequestHandler,
  requireSuperAdmin: RequestHandler,
): Router {
  const router = Router();
  router.post('/:id/delete-account', requireAuth('ADMIN'), requireSuperAdmin, closeAccount);
  return router;
}
