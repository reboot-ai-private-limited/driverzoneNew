import type { RequestHandler } from 'express';
import type { AuthPrincipal, Role } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import { verifyAccessToken } from '@/shared/security/jwt.js';

/**
 * Route protection: `router.post('/duty', requireAuth('DRIVER'), controller)`.
 *
 * The principal is hung on `req` rather than put in `request-context.ts`'s AsyncLocalStorage.
 * That file says why in its own header — it is a correlation channel, deliberately narrow, and
 * the current user is a dependency that belongs in a signature where a test can substitute it,
 * not ambient state a use case can reach for invisibly.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. Absent on unauthenticated routes — check, don't assume. */
      principal?: AuthPrincipal;
    }
  }
}

/** `Authorization: Bearer <jwt>` → the token, or undefined if the header is missing/misshapen. */
function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const [scheme, token] = header.split(' ');
  // Case-insensitive: RFC 7235 says the scheme is, and clients disagree about capitalisation.
  if (scheme?.toLowerCase() !== 'bearer') return undefined;
  return token !== undefined && token !== '' ? token : undefined;
}

/**
 * Two distinct failures, deliberately not merged:
 *
 *   401 UNAUTHENTICATED — no usable token. "Sign in."
 *   403 FORBIDDEN       — a valid token for the WRONG role. "You're signed in, but not as this."
 *
 * A client that cannot tell these apart either loops re-authenticating a customer into a driver
 * route forever, or silently signs someone out who was never signed out.
 */
export function requireAuth(role: Role): RequestHandler {
  return (req, _res, next) => {
    void (async () => {
      const token = bearerToken(req.headers.authorization);
      if (token === undefined) {
        next(AppError.unauthenticated());
        return;
      }

      const claims = await verifyAccessToken(token, role);
      if (claims === undefined) {
        // Verification already enforced the audience, so a token that is valid for a DIFFERENT
        // role lands here too. Re-check without the audience constraint to tell the two apart —
        // this runs only on the failure path, so it costs nothing in the normal case.
        const wrongAudience = await anyRoleClaims(token);
        next(wrongAudience === undefined ? AppError.unauthenticated() : AppError.forbidden());
        return;
      }

      req.principal = { sub: claims.sub, role: claims.role };
      next();
    })();
  };
}

/** Verifies signature and expiry while ignoring audience — used only to classify a failure. */
async function anyRoleClaims(token: string): Promise<AuthPrincipal | undefined> {
  for (const candidate of ['CUSTOMER', 'DRIVER', 'ADMIN'] as const) {
    const claims = await verifyAccessToken(token, candidate);
    if (claims !== undefined) return { sub: claims.sub, role: claims.role };
  }
  return undefined;
}
