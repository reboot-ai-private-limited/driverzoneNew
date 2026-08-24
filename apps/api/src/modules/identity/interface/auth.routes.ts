import { Router } from 'express';
import type { Role } from '@driverzone/contracts';
import { rateLimitMiddleware } from '@/shared/http/rateLimit.middleware.js';
import type { AuthControllers } from './auth.controller.js';

/**
 * INTERFACE — the auth routes for one role.
 *
 * Built once per role and mounted at `/customer/auth`, `/driver/auth` and `/admin/auth`. The
 * role is baked into the controllers rather than read from the path at request time, so nothing
 * a caller sends can change which one applies.
 *
 * **Two layers of throttling, and they are not redundant.** The limiter below is a blunt per-IP
 * cap on the route itself — it stops a flood before it reaches Redis lookups, account queries or
 * an SMS provider. The per-phone cooldown and hourly caps live inside `SendOtpUseCase`, because
 * those are business rules about a phone number, need to survive a successful response, and have
 * to report `retry_after_seconds` in the error body. An IP limiter cannot express any of that,
 * and the use-case limits cannot stop traffic before it does work.
 */
export function buildAuthRouter(role: Role, controllers: AuthControllers): Router {
  const router = Router();

  const otpFlood = rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 30,
    // Namespaced by role so a shared office IP hitting the driver app does not spend the
    // customer app's budget.
    prefix: `otp:${role}`,
    message: 'Too many attempts from this connection. Please try again shortly.',
  });

  router.post('/otp/send', otpFlood, controllers.sendOtp);
  router.post('/otp/verify', otpFlood, controllers.verifyOtp);

  // Refresh is deliberately more permissive: a legitimate client refreshes every ~12 minutes,
  // but one behind a corporate NAT shares its IP with everyone else there.
  const refreshFlood = rateLimitMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 120,
    prefix: `refresh:${role}`,
  });

  router.post('/refresh', refreshFlood, controllers.refresh);

  // Unlimited by design: logout is idempotent, revokes rather than grants, and a client retrying
  // it after a dropped response must not be blocked from ending its own session.
  router.post('/logout', controllers.logout);

  return router;
}
