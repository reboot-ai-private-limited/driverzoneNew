import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the `drivers` collection (docs/LLD/database-schema.md).
 *
 * Phase 1 only needs `phone` and `fullName` for the auth flow, but the whole schema is declared
 * now rather than grown field-by-field: `mongo.ts` sets `strictQuery: true`, so any field not
 * declared here makes a *filter* on it throw — and a half-declared collection means the next
 * pass hits that failure from a query rather than from a schema it can read.
 *
 * Fields marked "phase 2" have no endpoint writing them yet.
 */

export type OnboardingStatus = 'INCOMPLETE' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface DriverDoc {
  _id: mongoose.Types.ObjectId;
  phone: string;
  fullName?: string | null;
  profilePicture?: string | null;
  homeZoneId?: mongoose.Types.ObjectId | null;
  carCategoryIds?: mongoose.Types.ObjectId[];

  isVerified: boolean;
  isOnDuty: boolean;
  isBlocked: boolean;
  blockedReason?: string | null;

  onboardingStatus: OnboardingStatus;
  onboardingRejectionReason?: string | null;
  verifiedBy?: mongoose.Types.ObjectId | null;
  verifiedAt?: Date | null;

  dob?: Date | null;
  gender?: string | null;
  experienceYears?: number | null;
  alternatePhone?: string | null;
  emergencyContact?: { name?: string; phone?: string } | null;
  address?: string | null;

  vehicleTypePreference?: string | null;
  vehicleCategoryPreference?: string[];

  canDriveHill: boolean;
  canDriveHillVerified: boolean;

  rating: number;
  ratingCount: number;
  acceptanceRate?: number | null;
  walletBalancePaise: number;
  lastLocation?: { type: 'Point'; coordinates: number[] } | null;
  lastLocationAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const driverSchema = new Schema<DriverDoc>(
  {
    // `unique: true` already declares the index; see customer.model.ts.
    phone: { type: String, required: true, unique: true },
    fullName: { type: String, default: null },
    profilePicture: { type: String, default: null },

    homeZoneId: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },
    carCategoryIds: [{ type: Schema.Types.ObjectId, ref: 'CarCategory' }],

    // THE gate. Dispatch and `POST /driver/duty` read this one boolean; `onboardingStatus` below
    // carries the richer story the driver app renders. One admin action sets both together, so
    // they cannot drift (docs/LLD/database-schema.md).
    isVerified: { type: Boolean, default: false },
    isOnDuty: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    blockedReason: { type: String, default: null },

    onboardingStatus: {
      type: String,
      default: 'INCOMPLETE',
      enum: ['INCOMPLETE', 'SUBMITTED', 'APPROVED', 'REJECTED'],
    },
    onboardingRejectionReason: { type: String, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
    verifiedAt: { type: Date, default: null },

    dob: { type: Date, default: null },
    gender: { type: String, enum: ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY', null], default: null },
    experienceYears: { type: Number, default: null },
    alternatePhone: { type: String, default: null },
    emergencyContact: {
      type: new Schema({ name: String, phone: String }, { _id: false }),
      default: null,
    },
    address: { type: String, default: null },

    // What this driver is COMPETENT to drive, not what they own (docs/LLD/open-questions.md Q5).
    vehicleTypePreference: { type: String, enum: ['AUTO', 'MANUAL', 'EV', null], default: null },
    vehicleCategoryPreference: { type: [String], default: [] },

    // Self-declared; gates nothing on its own. Hill dispatch checks the *Verified* flag, which
    // only an admin sets — hill driving is a safety matter (docs/LLD/open-questions.md Q6).
    canDriveHill: { type: Boolean, default: false },
    canDriveHillVerified: { type: Boolean, default: false },

    rating: { type: Number, default: 5.0 },
    ratingCount: { type: Number, default: 0 },
    acceptanceRate: { type: Number, default: null },
    walletBalancePaise: { type: Number, default: 0 },

    // A CACHE flushed from Redis, never written by the high-frequency ping path
    // (docs/LLD/architecture.md).
    lastLocation: {
      type: new Schema(
        { type: { type: String, enum: ['Point'] }, coordinates: [Number] },
        { _id: false },
      ),
      default: null,
    },
    lastLocationAt: { type: Date, default: null },
  },
  { timestamps: true },
);

driverSchema.index({ lastLocation: '2dsphere' });
// The dispatch eligibility query, in one index scan.
driverSchema.index({ isOnDuty: 1, isVerified: 1, isBlocked: 1, carCategoryIds: 1 });

export const DriverModel =
  (mongoose.models['Driver'] as mongoose.Model<DriverDoc> | undefined) ??
  mongoose.model<DriverDoc>('Driver', driverSchema);
