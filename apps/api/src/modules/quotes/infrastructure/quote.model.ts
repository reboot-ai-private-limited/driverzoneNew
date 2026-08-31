import mongoose, { Schema } from 'mongoose';
import { SERVICE_TYPES, DIRECTIONS } from '@driverzone/contracts';

/**
 * INFRASTRUCTURE — the `quotes` collection (docs/LLD/database-schema.md).
 *
 * `fare` is `Mixed` on purpose. It is a computed snapshot, written once and read back verbatim
 * into the booking; giving it a Mongoose sub-schema would mean two definitions of the fare shape
 * that have to be kept in step, and the authority is already `FareBreakdown` in the pricing
 * module. Nothing queries inside it.
 */

export interface QuoteDoc {
  _id: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  serviceType: string;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  scheduledAt: Date;
  direction?: string | null;
  distanceKm?: number | null;
  includedMinutes?: number | null;
  source: unknown;
  fare: unknown;
  expiresAt: Date;
  consumedBy?: mongoose.Types.ObjectId | null;
  createdAt: Date;
}

const pointSchema = new Schema(
  { lat: { type: Number, required: true }, lng: { type: Number, required: true } },
  { _id: false },
);

const quoteSchema = new Schema<QuoteDoc>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    serviceType: { type: String, enum: SERVICE_TYPES, required: true },
    pickup: { type: pointSchema, required: true },
    drop: { type: pointSchema, required: true },
    scheduledAt: { type: Date, required: true },
    direction: { type: String, enum: [...DIRECTIONS, null], default: null },
    distanceKm: { type: Number, default: null },
    includedMinutes: { type: Number, default: null },
    source: { type: Schema.Types.Mixed, required: true },
    fare: { type: Schema.Types.Mixed, required: true },
    expiresAt: { type: Date, required: true },
    consumedBy: { type: Schema.Types.ObjectId, ref: 'Booking', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

/**
 * TTL, set generously past the ten-minute expiry.
 *
 * The rows are deleted for housekeeping, not for correctness — consumption is already refused on
 * `expiresAt`, so an expired row lying around is harmless. Keeping them a day means a customer
 * asking "why did my price change" on the same evening can still be answered.
 */
quoteSchema.index({ createdAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

quoteSchema.index({ customerId: 1, createdAt: -1 });

export const QuoteModel =
  (mongoose.models['Quote'] as mongoose.Model<QuoteDoc> | undefined) ??
  mongoose.model<QuoteDoc>('Quote', quoteSchema);
