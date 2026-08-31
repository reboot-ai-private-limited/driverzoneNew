import mongoose, { Schema } from 'mongoose';

/**
 * INFRASTRUCTURE — the three collections the LLD refers to and never defines.
 *
 * All of them exist for one reason: `bookings.fareSnapshot` is immutable (invariant B-1), so
 * every charge decided AFTER the quote needs somewhere else to live. Putting them here rather
 * than as fields on the booking also means a receipt can show them as separate lines with their
 * own reasons, which is what a customer asking "what is this ₹50" actually needs.
 */

// ─── Fare adjustments ────────────────────────────────────────────────────────────────────────

export const ADJUSTMENT_TYPES = ['WAITING_CHARGE'] as const;

export interface FareAdjustmentDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  type: string;
  amountPaise: number;
  /** Shown on the receipt verbatim: 'Waiting — 25 min beyond the free 15'. */
  label: string;
  /** Set once the money has actually been collected. Null while it is merely owed. */
  settledByPaymentId?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const fareAdjustmentSchema = new Schema<FareAdjustmentDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    type: { type: String, enum: ADJUSTMENT_TYPES, required: true },
    amountPaise: { type: Number, required: true },
    label: { type: String, required: true },
    settledByPaymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * One adjustment of each type per booking. Completing a trip twice — a retried side effect after
 * a committed transaction — must not charge the waiting time twice.
 */
fareAdjustmentSchema.index({ bookingId: 1, type: 1 }, { unique: true });

export const FareAdjustmentModel =
  (mongoose.models['FareAdjustment'] as mongoose.Model<FareAdjustmentDoc> | undefined) ??
  mongoose.model<FareAdjustmentDoc>('FareAdjustment', fareAdjustmentSchema);

// ─── Cancellation charges ────────────────────────────────────────────────────────────────────

export interface CancellationChargeDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  /** Who pays. A driver's penalty is a ledger debit; a customer's is money kept from the refund. */
  chargedTo: string;
  amountPaise: number;
  /** The status the booking was in when it was cancelled — what the ladder was read at. */
  atStatus: string;
  reason: string;
  createdAt: Date;
}

const cancellationChargeSchema = new Schema<CancellationChargeDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    chargedTo: { type: String, enum: ['CUSTOMER', 'DRIVER'], required: true },
    amountPaise: { type: Number, required: true, min: 0 },
    atStatus: { type: String, required: true },
    reason: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

cancellationChargeSchema.index({ bookingId: 1 }, { unique: true });

export const CancellationChargeModel =
  (mongoose.models['CancellationCharge'] as mongoose.Model<CancellationChargeDoc> | undefined) ??
  mongoose.model<CancellationChargeDoc>('CancellationCharge', cancellationChargeSchema);

// ─── Pickup pin reports ──────────────────────────────────────────────────────────────────────

/**
 * A driver saying "I am here and the pin is not".
 *
 * The escape hatch from the arrival gate, and deliberately NOT a self-serve override: at 500 m a
 * failure is far more often a customer who dropped the pin on the wrong side of a flyover than a
 * GPS drifting. Routing it to ops fixes the actual problem, and accumulates a record of which
 * pins are wrong — which is worth more than an override button that silently absorbs it.
 */
export interface PickupPinReportDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  driverLocation: { lat: number; lng: number };
  pickupLocation: { lat: number; lng: number };
  distanceMetres: number;
  note?: string | null;
  resolvedAt?: Date | null;
  resolvedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const pointSchema = new Schema(
  { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
  { _id: false },
);

const pickupPinReportSchema = new Schema<PickupPinReportDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    driverLocation: { type: pointSchema, required: true },
    pickupLocation: { type: pointSchema, required: true },
    distanceMetres: { type: Number, required: true },
    note: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** The ops queue: everything still unresolved, oldest first. */
pickupPinReportSchema.index({ resolvedAt: 1, createdAt: 1 });

export const PickupPinReportModel =
  (mongoose.models['PickupPinReport'] as mongoose.Model<PickupPinReportDoc> | undefined) ??
  mongoose.model<PickupPinReportDoc>('PickupPinReport', pickupPinReportSchema);
