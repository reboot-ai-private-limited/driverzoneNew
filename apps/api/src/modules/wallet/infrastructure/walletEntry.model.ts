import mongoose, { Schema } from 'mongoose';
import {
  CUSTOMER_WALLET_ENTRY_TYPES,
  ONCE_PER_BOOKING_WALLET_TYPES,
} from '../domain/walletEntry.entity.js';

/**
 * INFRASTRUCTURE — the `customerWalletEntries` collection.
 *
 * `updatedAt` is deliberately OFF, as on every append-only collection in the repo
 * (`driverEarnings`, `bookingEvents`, `auditLog`): a row here is never edited, and an `updatedAt`
 * invites the reading that it might be.
 */

export interface WalletEntryDoc {
  _id: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  bookingId?: mongoose.Types.ObjectId | null;
  entryType: string;
  amountPaise: number;
  note?: string | null;
  createdAt: Date;
}

const walletEntrySchema = new Schema<WalletEntryDoc>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
    entryType: { type: String, enum: CUSTOMER_WALLET_ENTRY_TYPES, required: true },
    /** Signed. Positive is credit to the customer, negative is owed by them. */
    amountPaise: { type: Number, required: true },
    note: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/** The balance query and the customer's statement — both read one customer's whole history. */
walletEntrySchema.index({ customerId: 1, createdAt: -1 });

/**
 * IDEMPOTENCY, and the reason a retried cancellation cannot charge the fee twice.
 *
 * Partial rather than plain: a `FINE` or an `ADJUSTMENT` may legitimately repeat on one booking,
 * so the constraint covers only the types that must not. `bookingId: { $type: 'objectId' }` keeps
 * the null-booking rows (granted credit, standalone fines) out of the index entirely — several of
 * those per customer is the normal case, and a unique index over nulls would refuse the second.
 */
walletEntrySchema.index(
  { bookingId: 1, entryType: 1 },
  {
    unique: true,
    partialFilterExpression: {
      bookingId: { $type: 'objectId' },
      entryType: { $in: [...ONCE_PER_BOOKING_WALLET_TYPES] },
    },
  },
);

export const WalletEntryModel =
  (mongoose.models['CustomerWalletEntry'] as mongoose.Model<WalletEntryDoc> | undefined) ??
  mongoose.model<WalletEntryDoc>('CustomerWalletEntry', walletEntrySchema);
