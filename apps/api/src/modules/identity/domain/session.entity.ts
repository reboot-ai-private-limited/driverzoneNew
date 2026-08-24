import { createHash } from 'node:crypto';
import type { Role } from '@driverzone/contracts';

/**
 * DOMAIN — a refresh session and the rotation rules that make a stolen token detectable.
 *
 * The decision function at the bottom is the most security-critical logic in this module, and it
 * is deliberately pure: no clock of its own, no repository, no token strings. Everything it
 * needs arrives as an argument, so every branch is reachable in a test with three lines of
 * object literal.
 */

/**
 * How long after a token was legitimately used a second presentation is still treated as a
 * double-submit rather than theft.
 *
 * A mobile client on a weak signal genuinely does fire two refreshes: the first response is lost
 * in flight, the retry arrives with the same token. Five seconds covers that. It does not
 * meaningfully help an attacker — a thief who replays inside five seconds of the real client
 * still loses the race for the *next* rotation, and the family dies then.
 */
export const REFRESH_REUSE_GRACE_MS = 5_000;

export interface Session {
  sessionId: string;
  userId: string;
  role: Role;
  tokenHash: string;
  /** Shared by every session in one rotation chain. Revocation operates on this, not sessionId. */
  familyId: string;
  /** Set the moment this token is redeemed. Its presence is what makes a replay detectable. */
  usedAt?: Date | undefined;
  revokedAt?: Date | undefined;
}

/**
 * Refresh tokens are stored hashed, never in plaintext.
 *
 * Plain SHA-256 with no salt is correct here and would be wrong for a password: the input is
 * 200+ bits of signed JWT, not a human-chosen secret, so there is no dictionary to build and
 * nothing for a slow hash to defend. What this buys is that a dump of the sessions collection
 * hands an attacker no usable tokens.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * What to do with a presented refresh token.
 *
 * `REVOKE_FAMILY` is the interesting one: a token being presented twice, outside the grace
 * window, means two parties hold it. Since the legitimate client rotates away from a token the
 * instant it uses one, the second presenter is someone who obtained it another way. Killing the
 * whole family — not just this session — is what stops the thief simply continuing from
 * whatever rotation they have already performed.
 */
export type RefreshDecision =
  /** Good token, first use. Rotate: issue a new session in the same family. */
  | { action: 'ROTATE' }
  /**
   * Already used, but only just — the legitimate client double-submitted. Do NOT kill the
   * family; the other in-flight request already returned fresh tokens to this client, so this
   * one simply fails and the client uses what it already has.
   */
  | { action: 'REJECT_DOUBLE_SUBMIT' }
  /** Already used, past the grace window. Someone else has this token. */
  | { action: 'REVOKE_FAMILY' }
  /** The family is already dead, or this token was never valid. */
  | { action: 'REJECT' };

export function decideRefresh(session: Session | undefined, now: Date): RefreshDecision {
  // No matching session: either the token was forged with a leaked secret, or its session was
  // deleted. Nothing to revoke, nothing to trust.
  if (session === undefined) return { action: 'REJECT' };

  // The family was already revoked — by a previous theft detection, or by an explicit logout.
  if (session.revokedAt !== undefined) return { action: 'REJECT' };

  if (session.usedAt === undefined) return { action: 'ROTATE' };

  const sinceUse = now.getTime() - session.usedAt.getTime();
  return sinceUse <= REFRESH_REUSE_GRACE_MS
    ? { action: 'REJECT_DOUBLE_SUBMIT' }
    : { action: 'REVOKE_FAMILY' };
}
