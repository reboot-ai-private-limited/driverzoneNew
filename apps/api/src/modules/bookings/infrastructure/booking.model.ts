import mongoose, { Schema } from 'mongoose';
import {
  BOOKING_ACTOR_TYPES,
  BOOKING_STATUSES,
  CAR_CATEGORIES,
  DIRECTIONS,
  PAYMENT_MODES,
  SERVICE_TYPES,
  VEHICLE_TYPE_PREFERENCES,
} from '@driverzone/contracts';

/**
 * INFRASTRUCTURE — `bookings` and `bookingEvents` (docs/LLD/database-schema.md).
 */

export interface BookingDoc {
  _id: mongoose.Types.ObjectId;
  reference: string;
  customerId: mongoose.Types.ObjectId;
  driverId?: mongoose.Types.ObjectId | null;
  status: string;
  serviceType: string;
  pickup: { lat: number; lng: number };
  pickupAddress: string;
  drop: { lat: number; lng: number };
  dropAddress: string;
  direction?: string | null;
  distanceKm?: number | null;
  carCategory?: string | null;
  vehicleType?: string | null;
  walletCreditPaise?: number;
  walletDebtPaise?: number;
  quoteId: mongoose.Types.ObjectId;
  fareSnapshot: unknown;
  paymentMode: string;
  paymentId?: mongoose.Types.ObjectId | null;
  isScheduled: boolean;
  scheduledAt: Date;
  dispatchAt: Date;
  startOtp: string;
  otpAttempts: number;
  assignedAt?: Date | null;
  enRouteAt?: Date | null;
  arrivedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  cancellationReason?: string | null;
  waitingMinutes?: number | null;
  waitingChargePaise?: number | null;
  driverLateMinutes?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const pointSchema = new Schema(
  { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
  { _id: false },
);

const bookingSchema = new Schema<BookingDoc>(
  {
    reference: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', default: null },
    status: { type: String, enum: BOOKING_STATUSES, required: true, default: 'PENDING_PAYMENT' },
    serviceType: { type: String, enum: SERVICE_TYPES, required: true },

    pickup: { type: pointSchema, required: true },
    pickupAddress: { type: String, required: true },
    drop: { type: pointSchema, required: true },
    dropAddress: { type: String, required: true },
    direction: { type: String, enum: [...DIRECTIONS, null], default: null },
    distanceKm: { type: Number, default: null },

    /*
     * What the customer is putting the driver in. Not priced — an SUV and a hatchback pay the same
     * fare for the same trip — it is purely who dispatch may ring (`MongoDriverPool`).
     *
     * NULLABLE ONLY FOR HISTORY. Every booking made since 2026-09-02 carries both; the nulls are
     * rows that predate the choice, and `null` there means "never asked", which the eligibility
     * query treats as no requirement rather than as a requirement nobody meets.
     */
    carCategory: { type: String, enum: [...CAR_CATEGORIES, null], default: null },
    vehicleType: { type: String, enum: [...VEHICLE_TYPE_PREFERENCES, null], default: null },

    /*
     * What the wallet did to this trip's price, frozen at creation. Never both non-zero — a
     * balance is either credit or debt. Default 0 covers every booking written before wallets
     * existed, for which the honest answer is 'the wallet did nothing'.
     */
    walletCreditPaise: { type: Number, default: 0, min: 0 },
    walletDebtPaise: { type: Number, default: 0, min: 0 },

    quoteId: { type: Schema.Types.ObjectId, ref: 'Quote', required: true },

    /*
     * IMMUTABLE — invariant B-1. What the customer agreed to, and no later charge may edit it:
     * waiting time, a late fine and a cancellation fee are all rows elsewhere.
     *
     * Note this SILENTLY IGNORES a write rather than throwing, so it is a guard and not an alarm.
     * The real protection is that nothing in the module has a reason to write it twice.
     */
    fareSnapshot: { type: Schema.Types.Mixed, required: true, immutable: true },
    paymentMode: { type: String, enum: PAYMENT_MODES, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },

    isScheduled: { type: Boolean, required: true, default: false },
    scheduledAt: { type: Date, required: true },
    dispatchAt: { type: Date, required: true },

    /*
     * PLAINTEXT, and `select: false`.
     *
     * Unlike a login OTP this is not a credential — it proves the customer is standing next to
     * the driver, and it is READ ALOUD, so it has a working life of about four seconds and an
     * audience of two people. Hashing it would buy nothing: the value is shown to the customer in
     * their own app, so it must be retrievable, which rules out a one-way hash entirely.
     *
     * `select: false` keeps it out of every incidental read, which is the protection that
     * actually matters — a booking list that accidentally serialises the OTP hands a driver every
     * code in the city.
     */
    startOtp: { type: String, required: true, select: false },
    otpAttempts: { type: Number, required: true, default: 0 },

    assignedAt: { type: Date, default: null },
    enRouteAt: { type: Date, default: null },
    arrivedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String, default: null },

    waitingMinutes: { type: Number, default: null },
    waitingChargePaise: { type: Number, default: null },
    driverLateMinutes: { type: Number, default: null },
  },
  { timestamps: true },
);

bookingSchema.index({ customerId: 1, createdAt: -1 });
bookingSchema.index({ driverId: 1, status: 1 });

/**
 * The sweeper's query, and partial so the index holds only the handful of rows actually waiting
 * rather than every booking ever made.
 */
bookingSchema.index({ dispatchAt: 1 }, { partialFilterExpression: { status: 'CONFIRMED' } });

export const BookingModel =
  (mongoose.models['Booking'] as mongoose.Model<BookingDoc> | undefined) ??
  mongoose.model<BookingDoc>('Booking', bookingSchema);

/**
 * APPEND-ONLY, and the product's memory.
 *
 * Every dispute is answered from this collection. In production the application's Mongo role has
 * `update` and `delete` revoked on it (docs/LLD/database-schema.md) — the absence of any update
 * path in this codebase is a convention; that grant is the guarantee.
 */
export interface BookingEventDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  fromStatus?: string | null;
  toStatus: string;
  actorType: string;
  actorId?: mongoose.Types.ObjectId | null;
  reason?: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const bookingEventSchema = new Schema<BookingEventDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    fromStatus: { type: String, enum: [...BOOKING_STATUSES, null], default: null },
    toStatus: { type: String, enum: BOOKING_STATUSES, required: true },
    actorType: { type: String, enum: BOOKING_ACTOR_TYPES, required: true },
    /** Polymorphic — a customer, a driver or an admin, resolved via `actorType`. Null for SYSTEM. */
    actorId: { type: Schema.Types.ObjectId, default: null },
    reason: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, required: true, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

bookingEventSchema.index({ bookingId: 1, createdAt: 1 });

export const BookingEventModel =
  (mongoose.models['BookingEvent'] as mongoose.Model<BookingEventDoc> | undefined) ??
  mongoose.model<BookingEventDoc>('BookingEvent', bookingEventSchema);
