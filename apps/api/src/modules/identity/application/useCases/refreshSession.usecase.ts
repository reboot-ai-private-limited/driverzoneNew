import type { Role } from '@driverzone/contracts';
import { verifyRefreshToken } from '@/shared/security/jwt.js';
import { logger } from '@/shared/logging/logger.js';
import { decideRefresh, hashRefreshToken } from '../../domain/session.entity.js';
import { refreshTokenInvalid, sessionRevoked } from '../../domain/identity.errors.js';
import type { SessionRepositoryPort } from '../../domain/session.repository.port.js';
import type { TokenIssuer } from '../tokenIssuer.js';

export interface RefreshSessionInput {
  role: Role;
  token: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface RefreshSessionResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * APPLICATION — rotate a refresh token, and notice when one has been stolen.
 *
 * The theft signal is simple and it is the reason sessions are persisted at all: the legitimate
 * client rotates away from a token the instant it spends one, so a token presented twice means
 * two parties hold it. When that happens outside the double-submit grace window, every session
 * in the family dies — including whatever rotations the thief already performed.
 */
export class RefreshSessionUseCase {
  constructor(
    private readonly sessions: SessionRepositoryPort,
    private readonly tokens: TokenIssuer,
  ) {}

  async execute(input: RefreshSessionInput): Promise<RefreshSessionResult> {
    const claims = await verifyRefreshToken(input.token, input.role);
    if (claims === undefined) throw refreshTokenInvalid();

    const session = await this.sessions.findBySessionId(claims.sid);

    /**
     * The token verified but does not match the hash on file.
     *
     * That means a validly-signed token for a session whose stored hash is something else —
     * which should be unreachable, and is exactly the shape a forged-with-a-leaked-secret token
     * would take. Refused without revoking anything: there is no evidence the *family* is
     * compromised, and revoking on an unauthenticated signal would be a denial-of-service anyone
     * could trigger.
     */
    if (session !== undefined && session.tokenHash !== hashRefreshToken(input.token)) {
      throw refreshTokenInvalid();
    }

    const now = new Date();
    const decision = decideRefresh(session, now);

    // Both non-rotating rejections collapse to the same response. A double-submit is the
    // client's own retry — its other in-flight request already holds fresh tokens — so it is not
    // an incident and is not logged as one.
    if (decision.action === 'REJECT' || decision.action === 'REJECT_DOUBLE_SUBMIT') {
      throw refreshTokenInvalid();
    }

    // Narrowing for the compiler, and a real guard: every remaining branch needs the session's
    // familyId, and `decideRefresh` only returns these two actions when a session exists.
    if (session === undefined) throw refreshTokenInvalid();

    if (decision.action === 'REVOKE_FAMILY') {
      await this.sessions.revokeFamily(session.familyId, now);
      logger.error(
        { familyId: session.familyId, sessionId: claims.sid, role: input.role },
        'refresh token reuse detected, family revoked',
      );
      throw sessionRevoked({ familyId: session.familyId });
    }

    const issued = await this.tokens.issueWithinFamily(claims.sub, input.role, session.familyId, {
      ip: input.ip,
      userAgent: input.userAgent,
    });

    /**
     * The old session is claimed AFTER the new one exists, and conditionally.
     *
     * `markUsed` returns false if another request got there first — two refreshes racing with the
     * same token. The loser revokes only the session it just created (never the family, which
     * would sign out the request that legitimately won) rather than handing out a second live
     * session from one spent token.
     */
    const claimed = await this.sessions.markUsed(claims.sid, now, issued.sessionId);
    if (!claimed) {
      await this.sessions.revokeSession(issued.sessionId, now);
      throw refreshTokenInvalid();
    }

    return { accessToken: issued.accessToken, refreshToken: issued.refreshToken };
  }
}
