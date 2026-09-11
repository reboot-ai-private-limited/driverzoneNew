import mongoose from 'mongoose';
import type {
  BookingExtension,
  ExtensionStatus,
} from '../domain/bookingExtension.entity.js';
import type {
  ExtensionRepositoryPort,
  NewExtension,
} from '../domain/extensionRepository.port.js';
import { BookingExtensionModel, type BookingExtensionDoc } from './bookingExtension.model.js';

/** Mongo's duplicate-key error — here, the one-pending-per-booking partial index. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}

function toEntity(doc: BookingExtensionDoc): BookingExtension {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    customerId: String(doc.customerId),
    driverId: String(doc.driverId),
    status: doc.status as ExtensionStatus,
    amountPaise: doc.amountPaise,
    driverAmountPaise: doc.driverAmountPaise,
    requestedAt: doc.createdAt,
    expiresAt: doc.expiresAt,
    respondedAt: doc.respondedAt ?? null,
  };
}

export class MongoExtensionRepository implements ExtensionRepositoryPort {
  /**
   * INSERT AND CATCH, not read-then-write. Checking for a pending row first and inserting if there
   * is none is a race two taps a few milliseconds apart both win. The partial unique index decides
   * it atomically, so the duplicate error IS the answer — `null`, meaning "one is already open" —
   * and not a fault to report.
   */
  async open(input: NewExtension): Promise<BookingExtension | null> {
    try {
      const doc = await BookingExtensionModel.create({
        bookingId: new mongoose.Types.ObjectId(input.bookingId),
        customerId: new mongoose.Types.ObjectId(input.customerId),
        driverId: new mongoose.Types.ObjectId(input.driverId),
        amountPaise: input.amountPaise,
        driverAmountPaise: input.driverAmountPaise,
        expiresAt: input.expiresAt,
      });

      return toEntity(doc.toObject() as BookingExtensionDoc);
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;
      throw error;
    }
  }

  async findPending(bookingId: string): Promise<BookingExtension | null> {
    if (!mongoose.isValidObjectId(bookingId)) return null;

    const doc = await BookingExtensionModel.findOne({ bookingId, status: 'PENDING' });
    return doc === null ? null : toEntity(doc.toObject() as BookingExtensionDoc);
  }

  async listForBooking(bookingId: string): Promise<BookingExtension[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];

    const docs = await BookingExtensionModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as BookingExtensionDoc));
  }

  /**
   * `status: 'PENDING'` and `expiresAt: { $gt: now }` are in the FILTER, not checked before it.
   *
   * A driver tapping Accept as the sweep expires the request must resolve one way or the other,
   * never both — so the expiry is part of the swap rather than a read that precedes it. The same
   * reasoning as `dispatch`'s offer `respond`.
   */
  async respond(
    extensionId: string,
    to: Extract<ExtensionStatus, 'ACCEPTED' | 'DECLINED'>,
    now: Date,
  ): Promise<BookingExtension | null> {
    if (!mongoose.isValidObjectId(extensionId)) return null;

    const doc = await BookingExtensionModel.findOneAndUpdate(
      { _id: extensionId, status: 'PENDING', expiresAt: { $gt: now } },
      { $set: { status: to, respondedAt: now } },
      { new: true },
    );

    return doc === null ? null : toEntity(doc.toObject() as BookingExtensionDoc);
  }

  /**
   * The sweep is the clock — the same shape `reviews` uses to publish a blind review whose window
   * closed. No queue job, because nothing here needs a per-request timer: one query a minute over
   * an index finds every request that has run out, and it keeps working after a Redis flush.
   */
  async expireStale(now: Date, limit: number): Promise<number> {
    const stale = await BookingExtensionModel.find({ status: 'PENDING', expiresAt: { $lte: now } })
      .select('_id')
      .limit(limit);

    if (stale.length === 0) return 0;

    const result = await BookingExtensionModel.updateMany(
      { _id: { $in: stale.map((doc) => doc._id) }, status: 'PENDING' },
      { $set: { status: 'EXPIRED', respondedAt: now } },
    );

    return result.modifiedCount;
  }
}
