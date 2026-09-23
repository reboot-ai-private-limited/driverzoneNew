import type { RequestHandler } from 'express';
import { AppError } from '@/shared/errors/AppError.js';
import type { AdminProfileRepositoryPort } from '../domain/adminProfile.repository.port.js';

/**
 * INTERFACE — lets a request through only if its admin is, right now, an active SUPER_ADMIN.
 *
 * Mount AFTER `requireAuth('ADMIN')`, which establishes who is asking; this decides whether they
 * may. The role is read from the DATABASE on every request rather than carried in the token, so a
 * demotion or deactivation takes effect on the very next request instead of when a 15-minute
 * access token happens to expire. These are the routes where that difference matters: creating
 * administrators and deleting people's accounts.
 *
 * Handed to other modules through the identity container, never imported by them — `accounts`
 * guards its admin deletion route with the same instance.
 */
export function makeRequireSuperAdmin(admins: AdminProfileRepositoryPort): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const adminId = req.principal?.sub;
      if (adminId === undefined) {
        next(AppError.unauthenticated());
        return;
      }

      // `findById` filters `isActive`, so a deactivated admin is refused here too.
      const admin = await admins.findById(adminId);
      if (admin?.adminRole !== 'SUPER_ADMIN') {
        next(AppError.forbidden('Only a super admin can do this.'));
        return;
      }

      next();
    })().catch(next);
  };
}
