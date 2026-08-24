import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { ROLES } from '@driverzone/contracts';
import type { Role } from '@driverzone/contracts';
import { env } from '@/config/env.js';

/**
 * Signing and verifying the two tokens. No database, no module dependency.
 *
 * This lives in `shared/` rather than inside `identity/` on purpose. Every module will
 * eventually need to CHECK a bearer token — bookings, dispatch, admin — and none of them should
 * have to import `identity` to do it. `identity` owns *issuing* tokens (it holds the session
 * repository); verification is a stateless function anything may call.
 *
 * `jose` rather than `jsonwebtoken`: it is ESM-native, and its verify API takes an explicit
 * algorithm allowlist instead of trusting the token's own `alg` header. That is what closes
 * algorithm-confusion outright rather than by convention — see docs/decision-log.md, 2026-08-24.
 */

const ALGORITHM = 'HS256';

/** Pinned on verify. A token asking to be checked with anything else is rejected, not obliged. */
const ACCEPTED_ALGORITHMS = [ALGORITHM];

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Refresh lifetimes differ by role, and admin's is the short one.
 *
 * 12 hours against 30 days is the residual safeguard kept for the highest-privilege role after
 * TOTP was dropped (docs/decision-log.md, 2026-08-24). Customer and driver are mobile apps whose
 * users expect to stay logged in.
 */
export const REFRESH_TOKEN_TTL_SECONDS: Record<Role, number> = {
  CUSTOMER: 30 * 24 * 60 * 60,
  DRIVER: 30 * 24 * 60 * 60,
  ADMIN: 12 * 60 * 60,
};

const encoder = new TextEncoder();
const accessKey = (): Uint8Array => encoder.encode(env.JWT_ACCESS_SECRET);
const refreshKey = (): Uint8Array => encoder.encode(env.JWT_REFRESH_SECRET);

/**
 * Claims are PARSED, not cast.
 *
 * `jwtVerify` proves the signature; it does not prove the payload has the shape we assumed. A
 * cast would make a malformed-but-correctly-signed token flow into the app as a valid principal
 * with `undefined` fields.
 */
const accessClaimsSchema = z.object({
  sub: z.string().min(1),
  role: z.enum(ROLES),
});

const refreshClaimsSchema = accessClaimsSchema.extend({
  /** The session record this token belongs to — what makes rotation and revocation possible. */
  sid: z.string().min(1),
});

export type AccessClaims = z.infer<typeof accessClaimsSchema>;
export type RefreshClaims = z.infer<typeof refreshClaimsSchema>;

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ role: claims.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    // The audience IS the role. A customer token presented on a driver route fails here rather
    // than relying on every route to remember to check.
    .setAudience(claims.role)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(accessKey());
}

export async function signRefreshToken(claims: RefreshClaims): Promise<string> {
  return new SignJWT({ role: claims.role, sid: claims.sid })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    .setAudience(claims.role)
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS[claims.role]}s`)
    .sign(refreshKey());
}

/**
 * Returns the claims, or `undefined` for ANY failure — bad signature, expired, wrong audience,
 * malformed payload.
 *
 * Undefined rather than a thrown error with a reason: the caller turns every one of these into
 * the same 401, and a function that distinguishes them invites a handler that leaks which.
 */
export async function verifyAccessToken(token: string, audience: Role): Promise<AccessClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, accessKey(), {
      algorithms: ACCEPTED_ALGORITHMS,
      audience,
    });
    const parsed = accessClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function verifyRefreshToken(token: string, audience: Role): Promise<RefreshClaims | undefined> {
  try {
    const { payload } = await jwtVerify(token, refreshKey(), {
      algorithms: ACCEPTED_ALGORITHMS,
      audience,
    });
    const parsed = refreshClaimsSchema.safeParse(payload);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
