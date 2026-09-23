import mongoose, { Schema } from 'mongoose';
import { ADMIN_ROLES, type AdminRole } from '@driverzone/contracts';

/**
 * INFRASTRUCTURE — the `adminUsers` collection (docs/LLD/database-schema.md).
 *
 * No password, no TOTP secret, no recovery codes: admin authenticates with phone + OTP like
 * every other role (docs/decision-log.md, 2026-08-24).
 *
 * Rows are created by a SUPER_ADMIN through `/admin/admins`, or by direct ops action as before.
 * The auth flow still never creates one — `AccountRepository.create` refuses this role, and an
 * unknown admin number is sent no code (docs/decision-log.md, 2026-09-23).
 */

export interface AdminUserDoc {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName: string;
  isActive: boolean;
  /**
   * Absent on every row written before roles existed, and read as `SUPER_ADMIN` — the power those
   * admins already had. See `LEGACY_ADMIN_ROLE` in `adminProfile.repository.impl.ts`.
   */
  adminRole?: AdminRole | null;
  createdBy?: mongoose.Types.ObjectId | null;
  deactivatedAt?: Date | null;
  deactivatedBy?: mongoose.Types.ObjectId | null;
  /**
   * Bumped on every active super admin inside the transaction that demotes or deactivates one.
   * Its only job is to make two such transactions WRITE the same documents, so Mongo aborts one
   * of them — see `changeGuarded` in the repository.
   */
  rosterVersion?: number;
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
    // No default on purpose: a default would be written onto legacy rows the next time they are
    // saved, silently demoting the admins who have run the system so far.
    adminRole: { type: String, enum: [...ADMIN_ROLES, null], default: undefined },
    createdBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    deactivatedAt: { type: Date, default: null },
    deactivatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    rosterVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);


export const AdminUserModel =
  (mongoose.models['AdminUser'] as mongoose.Model<AdminUserDoc> | undefined) ??
  mongoose.model<AdminUserDoc>('AdminUser', adminUserSchema);
