import mongoose, { Schema } from 'mongoose';
import { EXTENSION_STATUSES } from '../domain/bookingExtension.entity.js';

/**
 * INFRASTRUCTURE — the `bookingExtensions` collection.
 *
 * One row per day bought, so a trip extended twice has two rows. See
 * `domain/bookingExtension.entity.ts` for why that is a row rather than a counter.
 */

export interface BookingExtensionDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  driverId: mongoose.Types.ObjectId;
  status: string;
  amountPaise: number;
  driverAmountPaise: number;
  expiresAt: Date;
  respondedAt?: Date | null;
  createdAt: Date;
}

const bookingExtensionSchema = new Schema<BookingExtensionDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    /** Frozen too: the driver who agreed is the driver who is paid, even after a reassignment. */
    driverId: { type: Schema.Types.ObjectId, ref: 'Driver', required: true },

    status: { type: String, enum: EXTENSION_STATUSES, required: true, default: 'PENDING' },

    /*
     * Both frozen at request time from the booking's own `fareSnapshot.fare.perDay` — never read
     * live at settlement. Invariant B-1's reasoning, one level down: the customer was shown a
     * price and the driver an earning, and a package repriced mid-trip must move neither.
     */
    amountPaise: { type: Number, required: true, min: 0 },
    driverAmountPaise: { type: Number, required: true, min: 0 },

    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * AT MOST ONE PENDING REQUEST PER BOOKING, and it has to be a PARTIAL index.
 *
 * A plain unique on `bookingId` would allow only one extension ever, which is wrong — a trip can
 * legitimately be extended twice. Scoping the constraint to `status: 'PENDING'` says the real
 * rule: you may ask again, but not while an earlier ask is still unanswered. It is also what makes
 * a double-tapped Extend button one day rather than two.
 */
bookingExtensionSchema.index(
  { bookingId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } },
);

/** The receipt and the settlement read: every extension on one booking. */
bookingExtensionSchema.index({ bookingId: 1, status: 1 });

/** The sweep, which asks only for pending requests past their window. */
bookingExtensionSchema.index({ status: 1, expiresAt: 1 });

export const BookingExtensionModel =
  (mongoose.models['BookingExtension'] as mongoose.Model<BookingExtensionDoc> | undefined) ??
  mongoose.model<BookingExtensionDoc>(
    'BookingExtension',
    bookingExtensionSchema,
    'bookingExtensions',
  );
