import mongoose from 'mongoose';
import type { BookingStatus } from '@driverzone/contracts';
import { logger } from '../../../shared/logging/logger.js';
import type { Booking, FareSnapshot } from '../domain/booking.entity.js';
import { TRANSITIONS } from '../domain/booking.entity.js';
import type {
  BookingEvent,
  BookingRepositoryPort,
  NewBooking,
  TransitionPatch,
} from '../domain/bookingRepository.port.js';
import {
  BookingEventModel,
  BookingModel,
  type BookingDoc,
  type BookingEventDoc,
} from './booking.model.js';

function toEntity(doc: BookingDoc): Booking {
  return {
    id: String(doc._id),
    reference: doc.reference,
    customerId: String(doc.customerId),
    driverId: doc.driverId ? String(doc.driverId) : null,
    status: doc.status as BookingStatus,
    serviceType: doc.serviceType as Booking['serviceType'],
    pickup: doc.pickup,
    pickupAddress: doc.pickupAddress,
    drop: doc.drop,
    dropAddress: doc.dropAddress,
    direction: (doc.direction ?? null) as Booking['direction'],
    distanceKm: doc.distanceKm ?? null,
    carCategory: (doc.carCategory ?? null) as Booking['carCategory'],
    vehicleType: (doc.vehicleType ?? null) as Booking['vehicleType'],
    walletCreditPaise: doc.walletCreditPaise ?? 0,
    walletDebtPaise: doc.walletDebtPaise ?? 0,
    quoteId: String(doc.quoteId),
    fareSnapshot: doc.fareSnapshot as FareSnapshot,
    paymentMode: doc.paymentMode as Booking['paymentMode'],
    paymentId: doc.paymentId ? String(doc.paymentId) : null,
    isScheduled: doc.isScheduled,
    scheduledAt: doc.scheduledAt,
    dispatchAt: doc.dispatchAt,
    assignedAt: doc.assignedAt ?? null,
    enRouteAt: doc.enRouteAt ?? null,
    arrivedAt: doc.arrivedAt ?? null,
    startedAt: doc.startedAt ?? null,
    completedAt: doc.completedAt ?? null,
    cancelledAt: doc.cancelledAt ?? null,
    cancellationReason: doc.cancellationReason ?? null,
    waitingMinutes: doc.waitingMinutes ?? null,
    waitingChargePaise: doc.waitingChargePaise ?? null,
    driverLateMinutes: doc.driverLateMinutes ?? null,
    otpAttempts: doc.otpAttempts,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toEventEntity(doc: BookingEventDoc): BookingEvent {
  return {
    id: String(doc._id),
    bookingId: String(doc.bookingId),
    fromStatus: (doc.fromStatus ?? null) as BookingStatus | null,
    toStatus: doc.toStatus as BookingStatus,
    actorType: doc.actorType as BookingEvent['actorType'],
    actorId: doc.actorId ? String(doc.actorId) : null,
    reason: doc.reason ?? null,
    /*
     * `?? {}` because Mongoose does not persist an EMPTY Mixed object — a transition carrying no
     * metadata comes back with the field absent, not with `{}`. The contract promises a
     * `Record<string, unknown>`, so without this the wire omits the key entirely and any client
     * reading `event.metadata.something` throws on exactly the transitions that went fine.
     */
    metadata: doc.metadata ?? {},
    createdAt: doc.createdAt,
  };
}

/**
 * Writes the booking's first event — the creation itself, which has no `from` status and so
 * cannot go through `transition()`.
 *
 * Separate from the create so a failure here does not lose a booking that was paid for. It is
 * logged rather than thrown for the same reason: an event we failed to write is a gap in the
 * history, and losing the booking as well would be strictly worse.
 */
export async function recordCreationEvent(booking: Booking, actorId: string): Promise<void> {
  try {
    await BookingEventModel.create({
      bookingId: new mongoose.Types.ObjectId(booking.id),
      fromStatus: null,
      toStatus: 'PENDING_PAYMENT',
      actorType: 'CUSTOMER',
      actorId: new mongoose.Types.ObjectId(actorId),
      reason: null,
      metadata: { reference: booking.reference, quoteId: booking.quoteId },
    });
  } catch (error) {
    logger.error({ err: error, bookingId: booking.id }, 'could not record the booking creation event');
  }
}

export class MongoBookingRepository implements BookingRepositoryPort {
  async create(data: NewBooking): Promise<Booking> {
    const doc = await BookingModel.create({
      ...data,
      customerId: new mongoose.Types.ObjectId(data.customerId),
      quoteId: new mongoose.Types.ObjectId(data.quoteId),
      status: 'PENDING_PAYMENT',
    });

    const created = await BookingModel.findById(doc._id);
    const booking = toEntity((created ?? doc).toObject() as BookingDoc);

    // The history has to start where the booking does. This one event cannot go through
    // `transition()` — it has no `from` status — so it is written here instead.
    await recordCreationEvent(booking, data.customerId);

    return booking;
  }

  async findById(id: string): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await BookingModel.findById(id);
    return doc === null ? null : toEntity(doc.toObject() as BookingDoc);
  }

  async findByQuoteId(quoteId: string): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(quoteId)) return null;
    const doc = await BookingModel.findOne({ quoteId });
    return doc === null ? null : toEntity(doc.toObject() as BookingDoc);
  }

  async findByPaymentId(paymentId: string): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(paymentId)) return null;
    const doc = await BookingModel.findOne({ paymentId });
    return doc === null ? null : toEntity(doc.toObject() as BookingDoc);
  }

  async listForCustomer(customerId: string, limit: number): Promise<Booking[]> {
    if (!mongoose.isValidObjectId(customerId)) return [];
    const docs = await BookingModel.find({ customerId }).sort({ createdAt: -1 }).limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }

  /** Every trip assigned to this driver, newest first. See the port on why no status filter. */
  async listForDriver(driverId: string, limit: number): Promise<Booking[]> {
    if (!mongoose.isValidObjectId(driverId)) return [];
    const docs = await BookingModel.find({ driverId }).sort({ createdAt: -1 }).limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }

  /**
   * The trip this driver is currently on. See the port for why this read exists at all.
   *
   * The four statuses are listed rather than expressed as "not terminal": a status added to the
   * machine later must be an explicit decision about whether a driver is still working it, not
   * something a negation silently absorbs.
   */
  async findActiveForDriver(driverId: string): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(driverId)) return null;

    const doc = await BookingModel.findOne({
      driverId,
      status: { $in: ['ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] },
    }).sort({ createdAt: -1 });

    return doc === null ? null : toEntity(doc.toObject() as BookingDoc);
  }

  /**
   * The booking happening to this customer now. See the port for why `CONFIRMED` is excluded.
   *
   * `SEARCHING` is IN, unlike the driver's equivalent: a customer watching for a driver to be
   * found is mid-experience and has a screen of their own for it, whereas no driver holds a
   * booking in that state.
   */
  async findActiveForCustomer(customerId: string): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(customerId)) return null;

    const doc = await BookingModel.findOne({
      customerId,
      status: { $in: ['SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] },
    }).sort({ createdAt: -1 });

    return doc === null ? null : toEntity(doc.toObject() as BookingDoc);
  }

  /** The only read that lifts `select: false` on the OTP, so reaching for it is visible. */
  async readStartOtp(id: string): Promise<string | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await BookingModel.findById(id).select('+startOtp');
    return doc?.startOtp ?? null;
  }

  async incrementOtpAttempts(id: string): Promise<number> {
    const doc = await BookingModel.findByIdAndUpdate(id, { $inc: { otpAttempts: 1 } }, { new: true });
    return doc?.otpAttempts ?? 0;
  }

  async attachPayment(id: string, paymentId: string): Promise<void> {
    await BookingModel.findByIdAndUpdate(id, {
      $set: { paymentId: new mongoose.Types.ObjectId(paymentId) },
    });
  }

  /**
   * THE transition. Invariant B-3 lives here and nowhere else.
   *
   * Two writes that must not come apart: the status change and the event recording it. A booking
   * whose status moved with no event is a booking whose history lies, and the history is what
   * every dispute is settled from — so they go in a multi-document transaction, which is why
   * `docs/LLD/architecture.md` requires Mongo be a replica set even single-node.
   *
   * The status change itself is a COMPARE-AND-SWAP (`status: from` in the filter), not a
   * read-then-write. That is what makes a customer cancelling at the same instant a driver
   * accepts resolve to exactly one winner instead of a booking that is both.
   */
  async transition(input: {
    bookingId: string;
    from: BookingStatus;
    to: BookingStatus;
    actor: { type: BookingEvent['actorType']; id: string | null };
    reason?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    patch?: TransitionPatch | undefined;
  }): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(input.bookingId)) return null;

    if (!TRANSITIONS[input.from].includes(input.to)) {
      // A caller asking for a move that is not in the table is a bug in the caller, not a race.
      // Returning null would let it be mistaken for "someone else got there first".
      throw new Error(`${input.from} → ${input.to} is not a legal booking transition`);
    }

    const session = await mongoose.startSession();
    try {
      let updated: Booking | null = null;

      await session.withTransaction(async () => {
        const doc = await BookingModel.findOneAndUpdate(
          { _id: input.bookingId, status: input.from },
          { $set: { status: input.to, ...(input.patch ?? {}) } },
          { new: true, session },
        );

        if (doc === null) {
          updated = null;
          return;
        }

        await BookingEventModel.create(
          [
            {
              bookingId: doc._id,
              fromStatus: input.from,
              toStatus: input.to,
              actorType: input.actor.type,
              actorId:
                input.actor.id !== null && mongoose.isValidObjectId(input.actor.id)
                  ? new mongoose.Types.ObjectId(input.actor.id)
                  : null,
              reason: input.reason ?? null,
              metadata: input.metadata ?? {},
            },
          ],
          { session },
        );

        updated = toEntity(doc.toObject() as BookingDoc);
      });

      return updated;
    } finally {
      await session.endSession();
    }
  }

  async claimForDriver(bookingId: string, driverId: string): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(bookingId) || !mongoose.isValidObjectId(driverId)) return null;

    const now = new Date();
    const session = await mongoose.startSession();

    try {
      let claimed: Booking | null = null;

      await session.withTransaction(async () => {
        const doc = await BookingModel.findOneAndUpdate(
          { _id: bookingId, driverId: null, status: 'SEARCHING' },
          { $set: { driverId: new mongoose.Types.ObjectId(driverId), status: 'ASSIGNED', assignedAt: now } },
          { new: true, session },
        );

        if (doc === null) {
          claimed = null;
          return;
        }

        await BookingEventModel.create(
          [
            {
              bookingId: doc._id,
              fromStatus: 'SEARCHING',
              toStatus: 'ASSIGNED',
              actorType: 'DRIVER',
              actorId: new mongoose.Types.ObjectId(driverId),
              reason: null,
              metadata: { claimed: true },
            },
          ],
          { session },
        );

        claimed = toEntity(doc.toObject() as BookingDoc);
      });

      return claimed;
    } finally {
      await session.endSession();
    }
  }

  async listEvents(bookingId: string): Promise<BookingEvent[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await BookingEventModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toEventEntity(doc.toObject() as BookingEventDoc));
  }

  async findDueForDispatch(now: Date, limit: number): Promise<Booking[]> {
    const docs = await BookingModel.find({ status: 'CONFIRMED', dispatchAt: { $lte: now } })
      .sort({ dispatchAt: 1 })
      .limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }

  async findAbandonedPayments(before: Date, limit: number): Promise<Booking[]> {
    const docs = await BookingModel.find({ status: 'PENDING_PAYMENT', createdAt: { $lte: before } })
      .sort({ createdAt: 1 })
      .limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }
}
