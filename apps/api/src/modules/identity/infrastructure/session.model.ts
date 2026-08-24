import mongoose, { Schema } from 'mongoose';
import type { Role } from '@driverzone/contracts';

/**
 * INFRASTRUCTURE — the `sessions` collection (docs/LLD/03-database-schema.md).
 *
 * One document per refresh token ever issued, including the spent ones. Spent rows are what
 * makes reuse detectable at all — delete a session on rotation and a replayed token becomes
 * indistinguishable from an expired one, which is precisely the case that needs telling apart.
 */

export interface SessionDoc {
  _id: mongoose.Types.ObjectId;
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  role: Role;
  tokenHash: string;
  familyId: string;
  usedAt?: Date | null;
  replacedBy?: string | null;
  revokedAt?: Date | null;
  expiresAt: Date;
  createdIp?: string | null;
  createdUserAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<SessionDoc>(
  {
    // `unique: true` already declares the index; see customer.model.ts.
    sessionId: { type: String, required: true, unique: true },

    // Polymorphic by design — the owner is one of three collections, resolved by `role` in
    // application code rather than by a Mongoose `ref` that can only name one.
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true, enum: ['CUSTOMER', 'DRIVER', 'ADMIN'] },

    // sha256 of the refresh JWT. A dump of this collection yields nothing presentable.
    tokenHash: { type: String, required: true },

    // Shared across a whole rotation chain. Reuse detection revokes by this, never by sessionId.
    familyId: { type: String, required: true },

    usedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },
    revokedAt: { type: Date, default: null },

    expiresAt: { type: Date, required: true },

    createdIp: { type: String, default: null },
    createdUserAgent: { type: String, default: null },
  },
  { timestamps: true },
);

sessionSchema.index({ userId: 1, role: 1 });
// Reuse detection revokes a whole family at once — this is the index that makes that one query.
sessionSchema.index({ familyId: 1 });

/**
 * Rows outlive their token by a day.
 *
 * TTL on `createdAt` + the longest refresh lifetime (30 days) + a day of slack, so a client
 * retrying slightly past expiry gets a clean "sign in again" from a row that still exists,
 * rather than the ambiguous nothing-found that a tighter TTL would produce.
 */
sessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 31 });

export const SessionModel =
  (mongoose.models['Session'] as mongoose.Model<SessionDoc> | undefined) ??
  mongoose.model<SessionDoc>('Session', sessionSchema);
