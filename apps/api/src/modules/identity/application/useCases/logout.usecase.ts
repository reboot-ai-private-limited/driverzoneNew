import type { Role } from '@driverzone/contracts';
import { verifyRefreshToken } from '@/shared/security/jwt.js';
import type { SessionRepositoryPort } from '../../domain/session.repository.port.js';

export interface LogoutInput {
  role: Role;
  /** Absent when the client sent no token at all — still a successful logout. */
  token?: string | undefined;
}

/**
 * APPLICATION — end a session.
 *
 * **Never fails.** A missing token, an expired one, a garbage string, a session already revoked:
 * every one of them means "this client is not logged in", which is the state the caller asked
 * for. Returning an error for a token that was already dead would leave a client that retried
 * after a dropped response staring at a failure for something that had, in fact, happened.
 *
 * The whole FAMILY is revoked, not just the presented session. Logging out is a deliberate act
 * on a device, and leaving the rotation chain alive would mean a refresh token captured earlier
 * in that chain still works afterwards.
 */
export class LogoutUseCase {
  constructor(private readonly sessions: SessionRepositoryPort) {}

  async execute(input: LogoutInput): Promise<void> {
    if (input.token === undefined || input.token === '') return;

    const claims = await verifyRefreshToken(input.token, input.role);
    if (claims === undefined) return;

    const session = await this.sessions.findBySessionId(claims.sid);
    if (session === undefined) return;

    await this.sessions.revokeFamily(session.familyId, new Date());
  }
}
