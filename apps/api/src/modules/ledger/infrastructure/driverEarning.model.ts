import mongoose, { Schema } from 'mongoose';
import { LEDGER_ENTRY_TYPES, ONCE_PER_BOOKING_TYPES } from '../domain/ledgerEntry.entity.js';

/**
 * INFRASTRUCTURE — the `driverEarnings` collection (docs/LLD/database-schema.md).
 *
 * `updatedAt` is deliberately OFF. An append-only collection with an `updatedAt` invites the
 * reading that rows are edited, and the whole value of this table is that they are not. Every
 * other append-only collection in the repo — `bookingEvents`, `auditLog`, `coverageRequests` —
 * is declared the same way.
 */

export interface DriverEarningDoc {
  _id: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  bookingId?: mongoose.Types.ObjectId | null;
  entryType: string;
  amountPaise: number;
  note?: string | null;
  payoutId?: mongoose.Types.ObjectId | null;
  idempotencyKey?: string | null;
  createdAt: Date;
}

const driverEarningSchema = new Schema<DriverEarningDoc>(
  {
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    entryType: { type: String, enum: LEDGER_ENTRY_TYPES, required: true },
    amountPaise: { type: Number, required: true },
    note: { type: String, default: null },
    payoutId: { type: Schema.Types.ObjectId, ref: 'Payout', default: null },
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** The balance query and the driver's statement, both of which read one driver's whole history. */
driverEarningSchema.index({ driverId: 1, createdAt: -1 });

/** The payout run: everything not yet paid out, per driver. */
driverEarningSchema.index({ driverId: 1, payoutId: 1 });

/**
 * IDEMPOTENCY, and the reason completing a trip twice cannot pay a driver twice.
 *
 * Partial rather than plain: `PENALTY` and `ADJUSTMENT` rows may legitimately repeat on one
 * booking, so the constraint applies only to the types that must not. `bookingId: { $type: 'objectId' }`
 * keeps null-booking rows (payouts, bonuses) out of the index entirely — several of those per
 * driver is normal, and a unique index over nulls would refuse the second one.
 */
driverEarningSchema.index(
  { bookingId: 1, entryType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bookingId: { $type: 'objectId' },
      entryType: { $in: [...ONCE_PER_BOOKING_TYPES] },
    },
  },
);

/**
 * One key, one row. What makes a double-tapped Settle button clear a balance once.
 *
 * PARTIAL, on `$type: 'string'` — almost every row in this collection has no key at all (a trip
 * completion is deduplicated by the index above instead), and a plain unique index over all those
 * nulls would refuse the second one ever written. The same shape, and the same reason, as the
 * once-per-booking index above it.
 */
driverEarningSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const DriverEarningModel =
  (mongoose.models['DriverEarning'] as mongoose.Model<DriverEarningDoc> | undefined) ??
  mongoose.model<DriverEarningDoc>('DriverEarning', driverEarningSchema);
