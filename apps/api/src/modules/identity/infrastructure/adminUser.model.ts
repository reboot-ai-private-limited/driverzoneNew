import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `adminUsers` collection (docs/LLD/03-database-schema.md).
 *
 * No password, no TOTP secret, no recovery codes: admin authenticates with phone + OTP like
 * every other role (docs/decision-log.md, 2026-08-24).
 *
 * There is deliberately **no create path in the application** — no registration endpoint, and
 * `AccountRepository.create` refuses this role. A row gets here by direct ops action only, which
 * is the residual safeguard that replaced the second factor.
 */

export interface AdminUserDoc {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const adminUserSchema = new Schema<AdminUserDoc>(
  {
    // `unique: true` already declares the index; see customer.model.ts.
    phone: { type: String, required: true, unique: true },
    // Required, unlike customer and driver: an admin record is authored by a human who already
    // knows who it is for, so there is no progressive-completion case to accommodate.
    fullName: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);


export const AdminUserModel =
  (mongoose.models['AdminUser'] as mongoose.Model<AdminUserDoc> | undefined) ??
  mongoose.model<AdminUserDoc>('AdminUser', adminUserSchema);
