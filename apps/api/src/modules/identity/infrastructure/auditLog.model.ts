import mongoose, { Schema } from 'mongoose';
import type { AuditAction } from '../domain/audit.port.js';

/**
 * INFRASTRUCTURE — the `auditLog` collection (docs/LLD/03-database-schema.md).
 *
 * Append-only in intent: nothing in the application ever updates or deletes a row, and
 * `timestamps: { updatedAt: false }` says so in the schema. The `bookingEvents` collection gets
 * this enforced at the database role; this one should follow when that role is next revised —
 * an audit log the application can rewrite answers no question worth asking.
 */

export interface AuditLogDoc {
  _id: mongoose.Types.ObjectId;
  adminId: mongoose.Types.ObjectId;
  entityType: string;
  entityId: mongoose.Types.ObjectId;
  action: AuditAction;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  createdAt: Date;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    adminId: { type: Schema.Types.ObjectId, ref: 'AdminUser', required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },

    // APPROVE/REJECT are not folded into UPDATE: "who approved this driver, and when" is the
    // question this collection exists to answer, and it must not require reading `after` to
    // tell an approval from an edit to a phone number.
    action: {
      type: String,
      required: true,
      enum: ['CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'APPROVE', 'REJECT'],
    },

    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// "What happened to this driver" — the entity timeline, newest first.
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
// "What did this admin do" — the accountability view.
auditLogSchema.index({ adminId: 1, createdAt: -1 });

export const AuditLogModel =
  (mongoose.models['AuditLog'] as mongoose.Model<AuditLogDoc> | undefined) ??
  mongoose.model<AuditLogDoc>('AuditLog', auditLogSchema);
