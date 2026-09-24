import type { Role } from '@driverzone/contracts';
import type { Session } from './session.entity.js';

/**
 * PORT — persistence for refresh sessions.
 *
 * This is the only reason refresh is not a purely stateless JWT check: rotation and revocation
 * need somewhere to remember that a token was already spent. The cost is one lookup per refresh,
 * which happens at most every 15 minutes per client — cheap for a property statelessness cannot
 * provide at all.
 */
export interface SessionRepositoryPort {
  create(input: {
    sessionId: string;
    userId: string;
    role: Role;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    createdIp?: string | undefined;
    createdUserAgent?: string | undefined;
  }): Promise<void>;

  findBySessionId(sessionId: string): Promise<Session | undefined>;

  /**
   * Marks a session spent, but ONLY if it was not already — the return value says whether this
   * call was the one that claimed it.
   *
   * A conditional update rather than a plain write, because two refreshes arriving together
   * would otherwise both read `usedAt: undefined`, both rotate, and both succeed — precisely the
   * replay the whole mechanism exists to catch. The database decides the winner.
   */
  markUsed(sessionId: string, usedAt: Date, replacedBy: string): Promise<boolean>;

  /**
   * Revokes every session in the family. Called when a spent token is replayed outside the
   * grace window — the signature of a token in two hands.
   */
  revokeFamily(familyId: string, revokedAt: Date): Promise<void>;

  /**
   * Revokes exactly one session.
   *
   * Distinct from `revokeFamily` and not a convenience wrapper over it: the caller is the loser
   * of a rotation race, undoing only the session it just created. Revoking the family there
   * would sign out the request that legitimately won.
   */
  revokeSession(sessionId: string, revokedAt: Date): Promise<void>;

  /**
   * Revokes every live session this account holds, on every device.
   *
   * For the moments the ACCOUNT stops being valid rather than one token: an admin deactivated, an
   * account deleted. Revoking one family would leave the same person signed in on their other
   * phone. Access tokens already issued still run out their 15 minutes; refresh is what stops.
   */
  revokeAllForUser(userId: string, role: Role, revokedAt: Date): Promise<void>;
}
