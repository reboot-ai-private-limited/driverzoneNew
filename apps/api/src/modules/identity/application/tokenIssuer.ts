import type { Role } from '@driverzone/contracts';
import { REFRESH_TOKEN_TTL_SECONDS, signAccessToken, signRefreshToken } from '@/shared/security/jwt.js';
import { newSessionFamilyId, newSessionId } from '@/shared/ids.js';
import { hashRefreshToken } from '../domain/session.entity.js';
import type { SessionRepositoryPort } from '../domain/session.repository.port.js';

/**
 * APPLICATION — mints a token pair and records the session behind it.
 *
 * Extracted because login and refresh both do exactly this, and the ordering inside it is not
 * obvious: the session id must exist *before* the refresh token is signed, since the token
 * carries it as `sid`, and the token must be signed before the session row can store its hash.
 * A second hand-written copy of that dance in `refreshSession` would be the natural place for
 * the two to quietly diverge.
 */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export interface IssueContext {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export class TokenIssuer {
  constructor(private readonly sessions: SessionRepositoryPort) {}

  /**
   * Starts a NEW family — a fresh login, unrelated to any previous session.
   *
   * A new family is what makes signing in on a second device independent of the first: revoking
   * one family for token theft must not sign the user out of a device that was never involved.
   */
  async issueNewFamily(userId: string, role: Role, ctx: IssueContext): Promise<IssuedTokens> {
    return this.issue(userId, role, newSessionFamilyId(), ctx);
  }

  /** Continues an existing family — one step in a rotation chain. */
  async issueWithinFamily(
    userId: string,
    role: Role,
    familyId: string,
    ctx: IssueContext,
  ): Promise<IssuedTokens> {
    return this.issue(userId, role, familyId, ctx);
  }

  private async issue(
    userId: string,
    role: Role,
    familyId: string,
    ctx: IssueContext,
  ): Promise<IssuedTokens> {
    const sessionId = newSessionId();

    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken({ sub: userId, role }),
      signRefreshToken({ sub: userId, role, sid: sessionId }),
    ]);

    await this.sessions.create({
      sessionId,
      userId,
      role,
      // Hashed, never the token itself — a dump of this collection must hand an attacker nothing
      // it can present (see `session.entity.ts`).
      tokenHash: hashRefreshToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS[role] * 1000),
      createdIp: ctx.ip,
      createdUserAgent: ctx.userAgent,
    });

    return { accessToken, refreshToken, sessionId };
  }
}
