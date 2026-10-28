import mongoose from 'mongoose';
import type { Payment, PaymentQr, PaymentStatus } from '../domain/payment.entity.js';
import type {
  CreatePaymentData,
  PaymentRepositoryPort,
} from '../domain/paymentRepository.port.js';
import { PaymentModel, ProcessedWebhookEventModel, type PaymentDoc } from './payment.model.js';

const DUPLICATE_KEY = 11000;

function toEntity(doc: PaymentDoc): Payment {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    customerId: String(doc.customerId),
    kind: doc.kind as Payment['kind'],
    // Rows from before QR codes have no channel — and are all orders.
    channel: (doc.channel ?? 'ORDER') as Payment['channel'],
    metadata: doc.metadata ?? {},
    qr:
      doc.qr === null || doc.qr === undefined
        ? null
        : { upiUri: doc.qr.upiUri ?? null, imageUrl: doc.qr.imageUrl ?? null, expiresAt: doc.qr.expiresAt },
    status: doc.status as PaymentStatus,
    amountPaise: doc.amountPaise,
    refundedPaise: doc.refundedPaise,
    gatewayRef: doc.gatewayRef ?? null,
    providerPaymentId: doc.providerPaymentId ?? null,
    idempotencyKey: doc.idempotencyKey,
    failureReason: doc.failureReason ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export class MongoPaymentRepository implements PaymentRepositoryPort {
  /**
   * Creating with an idempotency key that already exists returns the EXISTING payment rather
   * than failing.
   *
   * Losing the unique-index race is the normal case, not an edge one: it is exactly what two
   * taps of Confirm arriving together look like. Reading the row back and returning it is what
   * makes the second tap a no-op instead of a 409 the app has to interpret.
   */
  async create(data: CreatePaymentData): Promise<Payment> {
    try {
      const doc = await PaymentModel.create({
        bookingId: new mongoose.Types.ObjectId(data.bookingId),
        customerId: new mongoose.Types.ObjectId(data.customerId),
        kind: data.kind,
        channel: data.channel ?? 'ORDER',
        metadata: data.metadata ?? {},
        amountPaise: data.amountPaise,
        idempotencyKey: data.idempotencyKey,
        status: 'CREATED',
      });
      return toEntity(doc.toObject() as PaymentDoc);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;

      const existing = await this.findByIdempotencyKey(data.idempotencyKey);
      if (existing === null) throw error;
      return existing;
    }
  }

  async findById(id: string): Promise<Payment | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await PaymentModel.findById(id);
    return doc === null ? null : toEntity(doc.toObject() as PaymentDoc);
  }

  async findByIdempotencyKey(key: string): Promise<Payment | null> {
    const doc = await PaymentModel.findOne({ idempotencyKey: key });
    return doc === null ? null : toEntity(doc.toObject() as PaymentDoc);
  }

  async findByGatewayRef(gatewayRef: string): Promise<Payment | null> {
    const doc = await PaymentModel.findOne({ gatewayRef });
    return doc === null ? null : toEntity(doc.toObject() as PaymentDoc);
  }

  async listForBooking(bookingId: string): Promise<Payment[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await PaymentModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as PaymentDoc));
  }

  /**
   * The compare-and-swap. `status: from` in the FILTER, not checked in application code first —
   * that is the whole point, and it is what makes a webhook and an API poll racing to settle the
   * same payment safe without a lock.
   */
  async transition(
    id: string,
    from: PaymentStatus,
    to: PaymentStatus,
    patch: {
      gatewayRef?: string;
      providerPaymentId?: string;
      failureReason?: string;
      refundedPaise?: number;
      qr?: PaymentQr;
    } = {},
  ): Promise<Payment | null> {
    if (!mongoose.isValidObjectId(id)) return null;

    const doc = await PaymentModel.findOneAndUpdate(
      { _id: id, status: from },
      { $set: { status: to, ...patch } },
      { new: true },
    );

    return doc === null ? null : toEntity(doc.toObject() as PaymentDoc);
  }

  async attachGatewayRef(id: string, gatewayRef: string): Promise<Payment | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await PaymentModel.findByIdAndUpdate(id, { $set: { gatewayRef } }, { new: true });
    return doc === null ? null : toEntity(doc.toObject() as PaymentDoc);
  }

  /**
   * Insert-or-lose. The unique index decides who was first, so two concurrent deliveries of the
   * same event cannot both be told they may proceed.
   */
  async markEventProcessed(eventId: string): Promise<boolean> {
    try {
      await ProcessedWebhookEventModel.create({ eventId });
      return true;
    } catch (error) {
      if (isDuplicateKey(error)) return false;
      throw error;
    }
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === DUPLICATE_KEY
  );
}
