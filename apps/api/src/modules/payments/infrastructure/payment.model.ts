import mongoose, { Schema } from 'mongoose';
import { PAYMENT_KINDS, PAYMENT_STATUSES } from '../domain/payment.entity.js';

export interface PaymentDoc {
  _id: mongoose.Types.ObjectId;
  bookingId: mongoose.Types.ObjectId;
  customerId: mongoose.Types.ObjectId;
  kind: string;
  status: string;
  amountPaise: number;
  refundedPaise: number;
  gatewayRef?: string | null;
  providerPaymentId?: string | null;
  idempotencyKey: string;
  failureReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<PaymentDoc>(
  {
    bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true },
    kind: { type: String, enum: PAYMENT_KINDS, required: true },
    status: { type: String, enum: PAYMENT_STATUSES, required: true, default: 'CREATED' },
    amountPaise: { type: Number, required: true, min: 0 },
    refundedPaise: { type: Number, required: true, default: 0, min: 0 },
    gatewayRef: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    idempotencyKey: { type: String, required: true },
    failureReason: { type: String, default: null },
  },
  { timestamps: true },
);

/** One key, one payment. This is what makes a double-tapped Confirm charge once. */
paymentSchema.index({ idempotencyKey: 1 }, { unique: true });

/**
 * Sparse, because a payment has no gateway reference until an intent is created and several rows
 * can legitimately be sitting at `CREATED` with none. A plain unique index would refuse the
 * second of them.
 */
paymentSchema.index({ gatewayRef: 1 }, { unique: true, sparse: true });

paymentSchema.index({ bookingId: 1, createdAt: -1 });

export const PaymentModel =
  (mongoose.models['Payment'] as mongoose.Model<PaymentDoc> | undefined) ??
  mongoose.model<PaymentDoc>('Payment', paymentSchema);

/**
 * Every gateway event id we have already acted on.
 *
 * Separate from `payments` because an event may arrive for a payment we cannot find, and we still
 * must not process it twice. TTL of 30 days: providers stop redelivering long before that, and
 * keeping them forever grows a collection nothing ever reads.
 */
export interface ProcessedWebhookEventDoc {
  _id: mongoose.Types.ObjectId;
  eventId: string;
  createdAt: Date;
}

const processedWebhookEventSchema = new Schema<ProcessedWebhookEventDoc>(
  { eventId: { type: String, required: true, unique: true } },
  { timestamps: { createdAt: true, updatedAt: false } },
);

processedWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const ProcessedWebhookEventModel =
  (mongoose.models['ProcessedWebhookEvent'] as
    | mongoose.Model<ProcessedWebhookEventDoc>
    | undefined) ??
  mongoose.model<ProcessedWebhookEventDoc>('ProcessedWebhookEvent', processedWebhookEventSchema);
