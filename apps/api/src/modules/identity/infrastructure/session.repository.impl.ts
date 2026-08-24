import mongoose from 'mongoose';
import type { Role } from '@driverzone/contracts';
import type { Session } from '../domain/session.entity.js';
import type { SessionRepositoryPort } from '../domain/session.repository.port.js';
import { SessionModel } from './session.model.js';

/** Mongo → domain. Nulls become undefined, so `usedAt !== undefined` is the only check needed. */
function toDomain(doc: {
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  role: Role;
  tokenHash: string;
  familyId: string;
  usedAt?: Date | null;
  revokedAt?: Date | null;
}): Session {
  return {
    sessionId: doc.sessionId,
    userId: String(doc.userId),
    role: doc.role,
    tokenHash: doc.tokenHash,
    familyId: doc.familyId,
    usedAt: doc.usedAt ?? undefined,
    revokedAt: doc.revokedAt ?? undefined,
  };
}

export class MongoSessionRepository implements SessionRepositoryPort {
  async create(input: {
    sessionId: string;
    userId: string;
    role: Role;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    createdIp?: string | undefined;
    createdUserAgent?: string | undefined;
  }): Promise<void> {
    await SessionModel.create({
      sessionId: input.sessionId,
      userId: new mongoose.Types.ObjectId(input.userId),
      role: input.role,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      expiresAt: input.expiresAt,
      createdIp: input.createdIp ?? null,
      // Truncated: a User-Agent is attacker-controlled and unbounded, and this field exists to
      // help a human recognise a session, not to be parsed.
      createdUserAgent: input.createdUserAgent?.slice(0, 255) ?? null,
    });
  }

  async findBySessionId(sessionId: string): Promise<Session | undefined> {
    const doc = await SessionModel.findOne({ sessionId }).lean().exec();
    return doc === null ? undefined : toDomain(doc);
  }

  /**
   * The conditional claim, and the reason this is not a plain `updateOne`.
   *
   * `usedAt: null` in the FILTER is what makes this atomic: two refreshes racing with the same
   * token both match on `sessionId`, but only one matches `usedAt: null`, so Mongo picks the
   * winner and the loser gets `modifiedCount: 0`. Read-then-write here would let both rotate.
   */
  async markUsed(sessionId: string, usedAt: Date, replacedBy: string): Promise<boolean> {
    const result = await SessionModel.updateOne(
      { sessionId, usedAt: null },
      { $set: { usedAt, replacedBy } },
    ).exec();
    return result.modifiedCount === 1;
  }

  async revokeFamily(familyId: string, revokedAt: Date): Promise<void> {
    // Only rows not already revoked, so an earlier revocation timestamp survives — that first
    // timestamp is when the compromise was detected, which is the one worth keeping.
    await SessionModel.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt } },
    ).exec();
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<void> {
    await SessionModel.updateOne({ sessionId, revokedAt: null }, { $set: { revokedAt } }).exec();
  }
}
