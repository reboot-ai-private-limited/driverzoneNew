import mongoose, { Schema } from 'mongoose';
import { CAR_CATEGORIES, VEHICLE_TYPE_PREFERENCES } from '@driverzone/contracts';

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

  vehicleTypePreferences?: string[];
  vehicleCategoryPreference?: string[];

  canDriveHill: boolean;
  canDriveHillVerified: boolean;

  rating: number;
  ratingCount: number;
  totalTrips: number;
  lastRideAt?: Date | null;
  acceptanceRate?: number | null;
  walletBalancePaise: number;
  lastLocation?: { type: 'Point'; coordinates: number[] } | null;
  lastLocationAt?: Date | null;

  /**
   * FCM registration tokens, one per handset the driver has signed in on.
   *
   * An ARRAY because a driver may carry a spare phone, and because a token that FCM has rotated
   * is not removed until a send fails against it — dropping the old one eagerly would lose the
   * ring on a device that is still working.
   */
  fcmTokens?: string[];

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

    /*
     * What this driver is COMPETENT to drive, not what they own (docs/LLD/open-questions.md Q5),
     * and the two gates `MongoDriverPool` matches a booking against.
     *
     * BOTH DEFAULT TO EMPTY, AND EMPTY MEANS NO OFFERS. A driver who has declared nothing is not
     * dispatchable — see the eligibility query for why that is deliberate rather than an
     * oversight. Existing drivers therefore need their preferences set before they ring again.
     *
     * `vehicleTypePreferences` was a single `String` until 2026-09-02. Drivers hold several: one
     * value per driver plus exact matching left three disjoint pools and starved every wave.
     */
    vehicleTypePreferences: { type: [String], enum: VEHICLE_TYPE_PREFERENCES, default: [] },
    vehicleCategoryPreference: { type: [String], enum: CAR_CATEGORIES, default: [] },

    // Self-declared; gates nothing on its own. Hill dispatch checks the *Verified* flag, which
    // only an admin sets — hill driving is a safety matter (docs/LLD/open-questions.md Q6).
    canDriveHill: { type: Boolean, default: false },
    canDriveHillVerified: { type: Boolean, default: false },

    rating: { type: Number, default: 5.0 },
    ratingCount: { type: Number, default: 0 },
    totalTrips: { type: Number, default: 0 },
    lastRideAt: { type: Date, default: null },
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
    fcmTokens: { type: [String], default: [] },
  },
  { timestamps: true },
);

driverSchema.index({ lastLocation: '2dsphere' });
/*
 * The dispatch eligibility query, in one index scan.
 *
 * `vehicleCategoryPreference` replaces `carCategoryIds` here: that was the legacy ObjectId ref,
 * nothing has ever populated it, so the old index keyed an empty array on every document.
 *
 * ONLY ONE OF THE TWO COMPETENCY ARRAYS IS IN IT. Mongo refuses a compound index that would be
 * multikey on more than one field, and category is the more selective of the pair — type has
 * three possible values and most drivers will hold two of them. Type is filtered from the
 * documents this index already narrowed to.
 */
driverSchema.index({
  isOnDuty: 1,
  isVerified: 1,
  isBlocked: 1,
  vehicleCategoryPreference: 1,
});

export const DriverModel =
  (mongoose.models['Driver'] as mongoose.Model<DriverDoc> | undefined) ??
  mongoose.model<DriverDoc>('Driver', driverSchema);
