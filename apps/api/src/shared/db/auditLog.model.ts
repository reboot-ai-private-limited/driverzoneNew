import mongoose, { Schema } from 'mongoose';

/**
 * SHARED — the `auditLog` collection (docs/LLD/database-schema.md).
 *
 * Lives in `shared/`, not inside one module, because the shape is already entity-agnostic
 * (`entityType` is the discriminator) and more than one module needs to write to it —
 * `identity` first, `zones` next. A module cannot reach into another module's
 * `infrastructure/` (`module-internals-are-private`), so a shared, entity-agnostic collection
 * belongs below every module rather than owned by whichever one happened to need it first.
 *
 * Append-only in intent: nothing in the application ever updates or deletes a row, and
 * `timestamps: { updatedAt: false }` says so in the schema. The `bookingEvents` collection gets
 * this enforced at the database role; this one should follow when that role is next revised —
 * an audit log the application can rewrite answers no question worth asking.
 */

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'ACTIVATE' | 'APPROVE' | 'REJECT' | 'SUSPEND' | 'UNSUSPEND';

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
      enum: ['CREATE', 'UPDATE', 'DELETE', 'ACTIVATE', 'APPROVE', 'REJECT', 'SUSPEND', 'UNSUSPEND'],
    },

    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ip: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// "What happened to this entity" — the entity timeline, newest first.
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
// "What did this admin do" — the accountability view.
auditLogSchema.index({ adminId: 1, createdAt: -1 });

export const AuditLogModel =
  (mongoose.models['AuditLog'] as mongoose.Model<AuditLogDoc> | undefined) ??
  mongoose.model<AuditLogDoc>('AuditLog', auditLogSchema);
