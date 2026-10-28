import mongoose, { type FilterQuery, type PipelineStage } from 'mongoose';
import {
  RIDE_HISTORY_CANCELLED_STATUSES,
  RIDE_HISTORY_PRE_DISPATCH_STATUSES,
  type BookingStatus,
} from '@driverzone/contracts';
import { logger } from '../../../shared/logging/logger.js';
import type { Actor, Booking, FareSnapshot } from '../domain/booking.entity.js';
import { TRANSITIONS } from '../domain/booking.entity.js';
import type {
  AdminBookingFilter,
  BookingEvent,
  BookingRepositoryPort,
  CustomerHistoryCursor,
  CustomerHistoryQuery,
  DriverHistoryQuery,
  NewBooking,
  TransitionPatch,
} from '../domain/bookingRepository.port.js';
import {
  BookingEventModel,
  BookingModel,
  type BookingDoc,
  type BookingEventDoc,
} from './booking.model.js';
import { FareAdjustmentModel } from './charge.model.js';

/**
 * Every status a booking can still leave. Typed against `BookingStatus` so a status added to the
 * contract without a decision here fails to compile only if it is misspelled — adding one still
 * means deciding whether it belongs in this list.
 */
const OPEN_BOOKING_STATUSES: readonly BookingStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'SEARCHING',
  'WAITING_DRIVER',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'ARRIVED',
  'STARTED',
];

/**
 * Count and sum of `amount` over one account's COMPLETED bookings, as a single aggregation row.
 *
 * `amount` is evaluated per booking and may read `$extensionRows.amountPaise` — the booking's
 * `DAY_EXTENSION` adjustment (at most one, by the `{ bookingId, type }` unique index, which the
 * `localField` form of `$lookup` uses). The match key must already be an ObjectId: aggregation,
 * unlike `find`, does not cast.
 */
async function completedTotals(
  owner: { customerId: mongoose.Types.ObjectId } | { driverId: mongoose.Types.ObjectId },
  amount: Record<string, unknown>,
): Promise<{ count: number; amountPaise: number }> {
  const [row] = await BookingModel.aggregate<{ count: number; amountPaise: number }>([
    { $match: { ...owner, status: 'COMPLETED' } },
    {
      $lookup: {
        from: FareAdjustmentModel.collection.name,
        localField: '_id',
        foreignField: 'bookingId',
        pipeline: [{ $match: { type: 'DAY_EXTENSION' } }, { $project: { _id: 0, amountPaise: 1 } }],
        as: 'extensionRows',
      },
    },
    { $group: { _id: null, count: { $sum: 1 }, amountPaise: { $sum: amount } } },
  ]).exec();
  return row ?? { count: 0, amountPaise: 0 };
}

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
    plateNumber: doc.plateNumber ?? null,
    rider:
      doc.rider === null || doc.rider === undefined ? null : { name: doc.rider.name, phone: doc.rider.phone },
    preferFavouriteDrivers: doc.preferFavouriteDrivers ?? false,
    dispatchMode: doc.dispatchMode === 'MANUAL' ? 'MANUAL' : 'AUTO',
    walletCreditPaise: doc.walletCreditPaise ?? 0,
    walletDebtPaise: doc.walletDebtPaise ?? 0,
    quoteId: String(doc.quoteId),
    fareSnapshot: doc.fareSnapshot as FareSnapshot,
    paymentMode: (doc.paymentMode ?? null) as Booking['paymentMode'],
    paymentStatus: (doc.paymentStatus ?? (doc.paymentMode === 'CASH' ? 'CASH' : doc.paymentMode === 'UPI' ? 'AWAITING_PAYMENT' : 'NOT_SELECTED')) as Booking['paymentStatus'],
    paymentId: doc.paymentId ? String(doc.paymentId) : null,
    paymentReference: doc.paymentReference ?? null,
    extrasCollection: (doc.extrasCollection ?? null) as Booking['extrasCollection'],
    paidExtensionPaise: doc.paidExtensionPaise ?? 0,
    cashExtensionPaise: doc.cashExtensionPaise ?? 0,
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
export async function recordCreationEvent(booking: Booking, actor: Actor): Promise<void> {
  try {
    await BookingEventModel.create({
      bookingId: new mongoose.Types.ObjectId(booking.id),
      fromStatus: null,
      toStatus: 'PENDING_PAYMENT',
      actorType: actor.type,
      actorId: actor.id === null ? null : new mongoose.Types.ObjectId(actor.id),
      reason: null,
      metadata: {
        reference: booking.reference,
        quoteId: booking.quoteId,
        dispatchMode: booking.dispatchMode,
        // On an admin booking the actor is the admin, so the customer it was made for is named.
        ...(actor.type === 'CUSTOMER' ? {} : { forCustomerId: booking.customerId }),
      },
    });
  } catch (error) {
    logger.error({ err: error, bookingId: booking.id }, 'could not record the booking creation event');
  }
}

export class MongoBookingRepository implements BookingRepositoryPort {
  async create(data: NewBooking): Promise<Booking> {
    const { createdBy, ...fields } = data;
    const doc = await BookingModel.create({
      ...fields,
      customerId: new mongoose.Types.ObjectId(data.customerId),
      quoteId: new mongoose.Types.ObjectId(data.quoteId),
      status: 'PENDING_PAYMENT',
    });

    const created = await BookingModel.findById(doc._id);
    const booking = toEntity((created ?? doc).toObject() as BookingDoc);

    // The history has to start where the booking does. This one event cannot go through
    // `transition()` — it has no `from` status — so it is written here instead.
    await recordCreationEvent(booking, createdBy);

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

  /**
   * One page of ride history, in ONE aggregation. See the port for the cursor.
   *
   * AN AGGREGATION, NOT A FIND, because both sort keys are computed: "when it happened" is the
   * first of completed/cancelled/scheduled that is set, and "amount" adds the waiting charge and
   * any extra day (an adjustment row in another collection) to the quoted fare. Everything runs
   * after the `customerId` match, which the `{ customerId, createdAt }` index serves, so the work
   * is bounded by one customer's history rather than the collection.
   *
   * `startOtp` IS PROJECTED OUT BY HAND. `select: false` on the schema only guards `find`; an
   * aggregation returns every stored field, and a history page is exactly the response that must
   * never carry trip codes.
   */
  async pageForCustomer(
    q: CustomerHistoryQuery,
  ): Promise<{ bookings: Booking[]; nextCursor: CustomerHistoryCursor | null }> {
    if (!mongoose.isValidObjectId(q.customerId)) return { bookings: [], nextCursor: null };

    // Aggregations do not cast — every id in a `$match` must already be an ObjectId.
    const match: Record<string, unknown> = { customerId: new mongoose.Types.ObjectId(q.customerId) };
    const and: Record<string, unknown>[] = [];

    const stillLater = {
      isScheduled: true,
      status: { $in: RIDE_HISTORY_PRE_DISPATCH_STATUSES },
      scheduledAt: { $gt: q.now },
    };
    switch (q.group) {
      case 'COMPLETED':
        match.status = 'COMPLETED';
        break;
      case 'CANCELLED':
        match.status = { $in: RIDE_HISTORY_CANCELLED_STATUSES };
        break;
      case 'SCHEDULED':
        Object.assign(match, stillLater);
        break;
      case 'RUNNING':
        match.status = { $nin: ['COMPLETED', ...RIDE_HISTORY_CANCELLED_STATUSES] };
        and.push({ $nor: [stillLater] });
        break;
      case undefined:
        break;
    }

    /*
     * Contains, not prefix — the app's search always matched anywhere in a reference or address,
     * and a customer types "salt lake", not the start of a street line. Escaped, so `(` from the
     * keyboard is a bracket and not a regex group.
     */
    if (q.search !== undefined && q.search.trim() !== '') {
      const term = new RegExp(q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const driverIds = (q.driverIds ?? [])
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      and.push({
        $or: [
          { reference: term },
          { pickupAddress: term },
          { dropAddress: term },
          ...(driverIds.length === 0 ? [] : [{ driverId: { $in: driverIds } }]),
        ],
      });
    }
    if (and.length > 0) match.$and = and;

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $project: { startOtp: 0 } },
      {
        $addFields: {
          happenedAt: { $ifNull: ['$completedAt', { $ifNull: ['$cancelledAt', '$scheduledAt'] }] },
        },
      },
    ];

    if (q.from !== undefined || q.before !== undefined) {
      pipeline.push({
        $match: {
          happenedAt: {
            ...(q.from === undefined ? {} : { $gte: q.from }),
            ...(q.before === undefined ? {} : { $lt: q.before }),
          },
        },
      });
    }

    if (q.sort === 'AMOUNT_DESC') {
      /*
       * The TRIP's cost, pre-wallet — what the row shows and what "high to low" ranks on. The
       * extra day lives on the `DAY_EXTENSION` adjustment written at completion, the same source
       * the mapper reads for a history row.
       */
      pipeline.push(
        {
          $lookup: {
            from: FareAdjustmentModel.collection.name,
            let: { bookingId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [{ $eq: ['$bookingId', '$$bookingId'] }, { $eq: ['$type', 'DAY_EXTENSION'] }],
                  },
                },
              },
              { $project: { _id: 0, amountPaise: 1 } },
            ],
            as: 'extensionRows',
          },
        },
        {
          $addFields: {
            sortKey: {
              $add: [
                { $ifNull: ['$fareSnapshot.fare.totalPaise', 0] },
                { $ifNull: ['$waitingChargePaise', 0] },
                { $sum: '$extensionRows.amountPaise' },
              ],
            },
          },
        },
      );
    } else {
      pipeline.push({ $addFields: { sortKey: { $toLong: '$happenedAt' } } });
    }

    if (q.cursor !== undefined && mongoose.isValidObjectId(q.cursor.id)) {
      const afterId = new mongoose.Types.ObjectId(q.cursor.id);
      pipeline.push({
        $match: {
          $or: [{ sortKey: { $lt: q.cursor.key } }, { sortKey: q.cursor.key, _id: { $lt: afterId } }],
        },
      });
    }

    // One extra row answers "is there another page" without a count.
    pipeline.push({ $sort: { sortKey: -1, _id: -1 } }, { $limit: q.limit + 1 });

    const docs = await BookingModel.aggregate<BookingDoc & { sortKey: number }>(pipeline).exec();
    const page = docs.slice(0, q.limit);
    const last = page[page.length - 1];

    return {
      bookings: page.map((doc) => toEntity(doc)),
      nextCursor:
        docs.length > q.limit && last !== undefined
          ? { key: Number(last.sortKey), id: String(last._id) }
          : null,
    };
  }

  /**
   * Counted over EVERY booking; spend over the completed ones only, each at the same net figure
   * its row shows (`netPayablePaise`, with the extra day from its adjustment row).
   *
   * SUMMED IN MONGO, not in code. Pulling every completed booking back to add them up made the
   * first page of history cost O(lifetime trips) on every open; the aggregation returns one row.
   * The arithmetic below must stay the same as `netPayablePaise` — the integration test pins it.
   */
  async customerHistorySummary(
    customerId: string,
  ): Promise<{ totalTrips: number; totalSpentPaise: number }> {
    if (!mongoose.isValidObjectId(customerId)) return { totalTrips: 0, totalSpentPaise: 0 };

    const [totalTrips, totals] = await Promise.all([
      BookingModel.countDocuments({ customerId }).exec(),
      completedTotals({ customerId: new mongoose.Types.ObjectId(customerId) }, {
        $max: [
          0,
          {
            $subtract: [
              {
                $add: [
                  { $ifNull: ['$fareSnapshot.fare.totalPaise', 0] },
                  { $sum: '$extensionRows.amountPaise' },
                  { $ifNull: ['$waitingChargePaise', 0] },
                  { $ifNull: ['$walletDebtPaise', 0] },
                ],
              },
              { $ifNull: ['$walletCreditPaise', 0] },
            ],
          },
        ],
      }),
    ]);

    return { totalTrips, totalSpentPaise: totals.amountPaise };
  }

  /**
   * `favourites` asking whether these two have really been on a trip together.
   *
   * `.exists()` rather than a find: the answer is a boolean, and Mongo can stop at the first
   * matching document. Both ids are validated first because an ObjectId cast failure inside a
   * filter throws rather than returning nothing, and a malformed id from a URL must read as
   * "no, they have not" rather than as a 500.
   */
  async hasCompletedTripTogether(customerId: string, driverId: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(customerId) || !mongoose.isValidObjectId(driverId)) return false;

    const match = await BookingModel.exists({ customerId, driverId, status: 'COMPLETED' });
    return match !== null;
  }

  async hasOpenBooking(party: 'CUSTOMER' | 'DRIVER', accountId: string): Promise<boolean> {
    if (!mongoose.isValidObjectId(accountId)) return false;

    const match = await BookingModel.exists({
      ...(party === 'CUSTOMER' ? { customerId: accountId } : { driverId: accountId }),
      status: { $in: OPEN_BOOKING_STATUSES },
    });
    return match !== null;
  }

  /** Every trip assigned to this driver, newest first. See the port on why no status filter. */
  async listForDriver(driverId: string, limit: number): Promise<Booking[]> {
    if (!mongoose.isValidObjectId(driverId)) return [];
    const docs = await BookingModel.find({ driverId }).sort({ createdAt: -1 }).limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }

  /**
   * One keyset page of the driver's trips. Same shape as `pageForCustomer` — an aggregation so the
   * sort key can be `happenedAt`, which is derived — minus the amount sort and the scheduled
   * bucket, neither of which the driver's list has.
   *
   * `startOtp` IS PROJECTED OUT BY HAND for the reason `pageForCustomer` gives: `select: false`
   * only guards `find`.
   */
  async pageForDriver(
    q: DriverHistoryQuery,
  ): Promise<{ bookings: Booking[]; nextCursor: CustomerHistoryCursor | null }> {
    if (!mongoose.isValidObjectId(q.driverId)) return { bookings: [], nextCursor: null };

    const match: Record<string, unknown> = { driverId: new mongoose.Types.ObjectId(q.driverId) };

    switch (q.group) {
      case 'COMPLETED':
        match.status = 'COMPLETED';
        break;
      case 'CANCELLED':
        match.status = { $in: RIDE_HISTORY_CANCELLED_STATUSES };
        break;
      case 'RUNNING':
        match.status = { $nin: ['COMPLETED', ...RIDE_HISTORY_CANCELLED_STATUSES] };
        break;
      case undefined:
        break;
    }

    if (q.search !== undefined && q.search.trim() !== '') {
      const term = new RegExp(q.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const customerIds = (q.customerIds ?? [])
        .filter((id) => mongoose.isValidObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id));
      match.$or = [
        { reference: term },
        { pickupAddress: term },
        { dropAddress: term },
        ...(customerIds.length === 0 ? [] : [{ customerId: { $in: customerIds } }]),
      ];
    }

    const pipeline: PipelineStage[] = [
      { $match: match },
      { $project: { startOtp: 0 } },
      {
        $addFields: {
          happenedAt: { $ifNull: ['$completedAt', { $ifNull: ['$cancelledAt', '$scheduledAt'] }] },
        },
      },
    ];

    if (q.from !== undefined || q.before !== undefined) {
      pipeline.push({
        $match: {
          happenedAt: {
            ...(q.from === undefined ? {} : { $gte: q.from }),
            ...(q.before === undefined ? {} : { $lt: q.before }),
          },
        },
      });
    }

    pipeline.push({ $addFields: { sortKey: { $toLong: '$happenedAt' } } });

    if (q.cursor !== undefined && mongoose.isValidObjectId(q.cursor.id)) {
      const afterId = new mongoose.Types.ObjectId(q.cursor.id);
      pipeline.push({
        $match: {
          $or: [{ sortKey: { $lt: q.cursor.key } }, { sortKey: q.cursor.key, _id: { $lt: afterId } }],
        },
      });
    }

    // One extra row answers "is there another page" without a count.
    pipeline.push({ $sort: { sortKey: -1, _id: -1 } }, { $limit: q.limit + 1 });

    const docs = await BookingModel.aggregate<BookingDoc & { sortKey: number }>(pipeline).exec();
    const page = docs.slice(0, q.limit);
    const last = page[page.length - 1];

    return {
      bookings: page.map((doc) => toEntity(doc)),
      nextCursor:
        docs.length > q.limit && last !== undefined
          ? { key: Number(last.sortKey), id: String(last._id) }
          : null,
    };
  }

  /**
   * Counted over EVERY trip; fares over the completed ones — what a row shows as its total (fare
   * plus the extra day from its adjustment row plus waiting), not the driver's commission share,
   * which is the ledger's to say.
   */
  async driverHistorySummary(
    driverId: string,
  ): Promise<{ totalTrips: number; completedTrips: number; faresPaise: number }> {
    if (!mongoose.isValidObjectId(driverId)) {
      return { totalTrips: 0, completedTrips: 0, faresPaise: 0 };
    }

    const [totalTrips, totals] = await Promise.all([
      BookingModel.countDocuments({ driverId }).exec(),
      // Summed in Mongo for the same reason as `customerHistorySummary`.
      completedTotals({ driverId: new mongoose.Types.ObjectId(driverId) }, {
        $add: [
          { $ifNull: ['$fareSnapshot.fare.totalPaise', 0] },
          { $sum: '$extensionRows.amountPaise' },
          { $ifNull: ['$waitingChargePaise', 0] },
        ],
      }),
    ]);

    return { totalTrips, completedTrips: totals.count, faresPaise: totals.amountPaise };
  }

  /**
   * The admin booking table. See the port for the shape of the filter.
   *
   * TWO QUERIES, not one: the page of documents and a `countDocuments` for the total, issued
   * together. An admin who filters to 128 rows needs the 128 to render "1 to 10 of 128", and a
   * count derived from the page is only ever right on the last page.
   *
   * Sorted by `scheduledAt`, NOT `createdAt` as the two history reads are. This table is read as a
   * diary — "what is happening on the 18th" — and a scheduled booking created last week belongs
   * on the day it is for, not the day it was made.
   */
  async listForAdmin(
    filter: AdminBookingFilter,
  ): Promise<{ bookings: Booking[]; totalItems: number }> {
    const query: FilterQuery<BookingDoc> = {};

    if (filter.statuses !== undefined && filter.statuses.length > 0) {
      query.status = { $in: filter.statuses };
    }

    if (filter.from !== undefined || filter.before !== undefined) {
      query.scheduledAt = {
        ...(filter.from === undefined ? {} : { $gte: filter.from }),
        ...(filter.before === undefined ? {} : { $lt: filter.before }),
      };
    }

    /*
     * The search UNION: a reference this module owns, or an account id `identity` resolved.
     *
     * Built only when a term was given. `accountIds` being empty is not the same as absent — it
     * means the term matched no person, and the `$or` must still be applied so the search can
     * correctly return nothing rather than falling through to every booking.
     */
    if (filter.search !== undefined && filter.search.trim() !== '') {
      const term = filter.search.trim();
      const ids = (filter.accountIds ?? []).filter((id) => mongoose.isValidObjectId(id));

      query.$or = [
        // Anchored and escaped: a reference is a short opaque code, so an admin pasting one wants
        // the row that starts with it, and metacharacters in the box must not reach the engine.
        { reference: new RegExp(`^${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i') },
        ...(ids.length === 0 ? [] : [{ customerId: { $in: ids } }, { driverId: { $in: ids } }]),
      ];
    }

    const [docs, totalItems] = await Promise.all([
      BookingModel.find(query)
        .sort({ scheduledAt: -1 })
        .skip((filter.page - 1) * filter.limit)
        .limit(filter.limit)
        .lean()
        .exec(),
      BookingModel.countDocuments(query).exec(),
    ]);

    return { bookings: docs.map((doc) => toEntity(doc as BookingDoc)), totalItems };
  }

  /**
   * The trip this driver is currently on. See the port for why this read exists at all.
   *
   * The four statuses are listed rather than expressed as "not terminal": a status added to the
   * machine later must be an explicit decision about whether a driver is still working it, not
   * something a negation silently absorbs.
   *
   * THE `$or` IS THE PRE-ASSIGNMENT FENCE the port describes: `ASSIGNED` carries a pickup-time
   * condition, the three moving statuses carry none. Written as one query rather than two reads
   * so "newest first" still ranks across both halves — a driver holding next week's booking AND
   * today's must get today's, and two sorted reads would need the caller to compare them again.
   */
  async findActiveForDriver(
    driverId: string,
    assignedPickupBefore?: Date | undefined,
  ): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(driverId)) return null;

    const doc = await BookingModel.findOne({
      driverId,
      ...(assignedPickupBefore === undefined
        ? { status: { $in: ['ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] } }
        : {
            $or: [
              { status: 'ASSIGNED', scheduledAt: { $lte: assignedPickupBefore } },
              { status: { $in: ['DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] } },
            ],
          }),
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
  async findActiveForCustomer(
    customerId: string,
    assignedPickupBefore?: Date | undefined,
  ): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(customerId)) return null;

    const doc = await BookingModel.findOne({
      customerId,
      ...(assignedPickupBefore === undefined
        ? { status: { $in: ['SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] } }
        : {
            // The pre-assignment fence — see the port. Shaped like the driver's, minus SEARCHING,
            // which is never a trip booked for later: it means a wave is ringing right now.
            $or: [
              { status: 'ASSIGNED', scheduledAt: { $lte: assignedPickupBefore } },
              { status: { $in: ['SEARCHING', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'] } },
            ],
          }),
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

  async setPaymentMode(
    id: string,
    mode: Booking['paymentMode'],
    status?: Booking['paymentStatus'],
  ): Promise<Booking | null> {
    const paymentStatus =
      status ?? (mode === 'CASH' ? 'CASH' : mode === 'UPI' ? 'AWAITING_PAYMENT' : 'NOT_SELECTED');
    const doc = await BookingModel.findByIdAndUpdate(
      id,
      { $set: { paymentMode: mode, paymentStatus } },
      { new: true },
    );
    return doc ? toEntity(doc.toObject() as BookingDoc) : null;
  }

  /**
   * One transaction, like `transition`: the switch to cash and the event that explains it land
   * together or not at all. The filter re-checks everything the use case checked, so an online
   * payment that captures in the same instant wins and this returns null.
   */
  async overridePaymentToCash(input: {
    bookingId: string;
    driverId: string;
    reason: string;
    metadata: Record<string, unknown>;
  }): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(input.bookingId) || !mongoose.isValidObjectId(input.driverId)) {
      return null;
    }

    const session = await mongoose.startSession();
    try {
      let updated: Booking | null = null;

      await session.withTransaction(async () => {
        const doc = await BookingModel.findOneAndUpdate(
          {
            _id: input.bookingId,
            driverId: input.driverId,
            status: 'STARTED',
            paymentStatus: { $ne: 'PAID' },
          },
          { $set: { paymentMode: 'CASH', paymentStatus: 'CASH' } },
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
              fromStatus: 'STARTED',
              toStatus: 'STARTED',
              actorType: 'DRIVER',
              actorId: new mongoose.Types.ObjectId(input.driverId),
              reason: input.reason,
              metadata: { paymentOverride: true, ...input.metadata },
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

  async setPaymentStatus(id: string, status: Booking['paymentStatus']): Promise<Booking | null> {
    const doc = await BookingModel.findByIdAndUpdate(
      id,
      { $set: { paymentStatus: status } },
      { new: true },
    );
    return doc ? toEntity(doc.toObject() as BookingDoc) : null;
  }

  async setPaidExtensionPaise(id: string, amountPaise: number): Promise<void> {
    await BookingModel.findByIdAndUpdate(id, { $set: { paidExtensionPaise: amountPaise } });
  }

  async addPaidExtensionPaise(id: string, amountPaise: number): Promise<void> {
    await BookingModel.findByIdAndUpdate(id, { $inc: { paidExtensionPaise: amountPaise } });
  }

  async addCashExtensionPaise(id: string, amountPaise: number): Promise<Booking | null> {
    /*
     * BOTH COUNTERS IN ONE `$inc`. `paidExtensionPaise` is what clears the completion gate and
     * `cashExtensionPaise` is what the ledger settles against; a driver who collected the day in
     * cash has satisfied both, and updating them in two calls would leave a window where the gate
     * is open on money the ledger has not been told about.
     */
    const doc = await BookingModel.findByIdAndUpdate(
      id,
      { $inc: { paidExtensionPaise: amountPaise, cashExtensionPaise: amountPaise } },
      { new: true },
    );
    return doc ? toEntity(doc) : null;
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

  async claimForDriver(
    bookingId: string,
    driverId: string,
    actor?: (Actor & { reason?: string }) | undefined,
  ): Promise<Booking | null> {
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
              actorType: actor?.type ?? 'DRIVER',
              actorId:
                actor === undefined
                  ? new mongoose.Types.ObjectId(driverId)
                  : actor.id !== null && mongoose.isValidObjectId(actor.id)
                    ? new mongoose.Types.ObjectId(actor.id)
                    : null,
              reason: actor?.reason ?? null,
              metadata: actor === undefined ? { claimed: true } : { claimed: true, manualAssignment: true },
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

  /**
   * BOTH WAITING STATES, and `WAITING_DRIVER` is the one that most needs catching.
   *
   * `CONFIRMED` is a booking whose dispatch job has not run yet; `WAITING_DRIVER` is one whose
   * early ring found nobody and which is now waiting on the final ring at T−90. A lost job on the
   * second is worse than on the first — the customer has already been told once that we are still
   * looking, and silently never ringing again is how that becomes a lie.
   */
  async findDueForDispatch(now: Date, limit: number): Promise<Booking[]> {
    const docs = await BookingModel.find({
      status: { $in: ['CONFIRMED', 'WAITING_DRIVER'] },
      dispatchAt: { $lte: now },
      // An admin assigns these by hand. `$ne` rather than `'AUTO'` so rows written before the
      // field existed — which have no value at all — are still swept.
      dispatchMode: { $ne: 'MANUAL' },
    })
      .sort({ dispatchAt: 1 })
      .limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }

  async enableAutoDispatch(id: string, dispatchAt: Date): Promise<Booking | null> {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await BookingModel.findOneAndUpdate(
      {
        _id: id,
        dispatchMode: 'MANUAL',
        driverId: null,
        status: { $in: ['CONFIRMED', 'WAITING_DRIVER'] },
      },
      { $set: { dispatchMode: 'AUTO', dispatchAt } },
      { new: true },
    );
    return doc === null ? null : toEntity(doc.toObject() as BookingDoc);
  }

  async findAbandonedPayments(before: Date, limit: number): Promise<Booking[]> {
    const docs = await BookingModel.find({ status: 'PENDING_PAYMENT', createdAt: { $lte: before } })
      .sort({ createdAt: 1 })
      .limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }

  /**
   * The scheduled board's contents, before any per-driver filtering.
   *
   * SORTED BY PICKUP, not by when the booking was made. A driver browsing this is planning their
   * days, so the only order that helps is chronological — "what is there on Tuesday morning".
   *
   * `scheduledAt: { $gt: after }` drops anything whose pickup has already passed. A parked booking
   * in the past is not work anybody can take; it is a row for ops to look at, and offering it here
   * would let a driver accept a trip they have already missed.
   */
  async findWaitingForDriver(after: Date, limit: number): Promise<Booking[]> {
    const docs = await BookingModel.find({
      status: 'WAITING_DRIVER',
      scheduledAt: { $gt: after },
    })
      .sort({ scheduledAt: 1 })
      .limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }

  /**
   * Every trip this driver already holds that has not happened yet — the input to the clash check.
   *
   * `ASSIGNED` only, and that is the whole set worth asking about: a trip they are actually ON is
   * `DRIVER_EN_ROUTE` or later, and if they are driving right now they cannot be browsing a board
   * for a future booking anyway. What matters here is the trips they have committed to and not
   * yet started.
   */
  async findUpcomingAssignedForDriver(driverId: string, after: Date): Promise<Booking[]> {
    if (!mongoose.isValidObjectId(driverId)) return [];
    const docs = await BookingModel.find({
      driverId,
      status: 'ASSIGNED',
      scheduledAt: { $gt: after },
    }).sort({ scheduledAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as BookingDoc));
  }
}
