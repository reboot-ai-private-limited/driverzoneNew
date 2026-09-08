import mongoose from 'mongoose';
import type { LedgerEntry, NewLedgerEntry } from '../domain/ledgerEntry.entity.js';
import type { LedgerRepositoryPort } from '../domain/ledgerRepository.port.js';
import { DriverEarningModel, type DriverEarningDoc } from './driverEarning.model.js';

function toEntity(doc: DriverEarningDoc): LedgerEntry {
  return {
    id: String(doc._id),
    driverId: String(doc.driverId),
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    entryType: doc.entryType as LedgerEntry['entryType'],
    amountPaise: doc.amountPaise,
    note: doc.note ?? null,
    payoutId: doc.payoutId ? String(doc.payoutId) : null,
    createdAt: doc.createdAt,
  };
}

/** Mongo's duplicate-key error, which is how the idempotency index reports a replay. */
const DUPLICATE_KEY = 11000;

export class MongoLedgerRepository implements LedgerRepositoryPort {
  /**
   * `ordered: false` so one duplicate does not abandon the rest of the batch.
   *
   * Completing a trip writes several entries at once, and a retry may find some already present
   * and some not — a crash between two inserts is exactly the case the idempotency index exists
   * for. With `ordered: true` the first duplicate stops the batch and the remaining entries are
   * silently lost. Unordered, Mongo attempts all of them and reports the duplicates, which we
   * then treat as "already written" rather than as a failure.
   */
  async append(entries: readonly NewLedgerEntry[]): Promise<LedgerEntry[]> {
    if (entries.length === 0) return [];

    const docs = entries.map((entry) => ({
      driverId: new mongoose.Types.ObjectId(entry.driverId),
      bookingId: entry.bookingId ? new mongoose.Types.ObjectId(entry.bookingId) : null,
      entryType: entry.entryType,
      amountPaise: entry.amountPaise,
      note: entry.note ?? null,
      payoutId: entry.payoutId ? new mongoose.Types.ObjectId(entry.payoutId) : null,
    }));

    try {
      const written = await DriverEarningModel.insertMany(docs, { ordered: false });
      return written.map((doc) => toEntity(doc.toObject() as DriverEarningDoc));
    } catch (error) {
      const result = asPartialInsertResult(error);
      if (result === null) throw error;
      return result;
    }
  }

  async sumForDriver(driverId: string): Promise<number> {
    if (!mongoose.isValidObjectId(driverId)) return 0;

    const [row] = await DriverEarningModel.aggregate<{ total: number }>([
      { $match: { driverId: new mongoose.Types.ObjectId(driverId) } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  /** `$gt: 0` in the match, so payouts and cash-collected rows cannot cancel out earnings. */
  async sumEarningsForDriver(driverId: string): Promise<number> {
    if (!mongoose.isValidObjectId(driverId)) return 0;

    const [row] = await DriverEarningModel.aggregate<{ total: number }>([
      { $match: { driverId: new mongoose.Types.ObjectId(driverId), amountPaise: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  async pageForDriver(
    driverId: string,
    page: number,
    limit: number,
    fromDate?: Date,
    toDate?: Date,
  ): Promise<{ entries: LedgerEntry[]; totalItems: number }> {
    if (!mongoose.isValidObjectId(driverId)) return { entries: [], totalItems: 0 };

    const query: any = { driverId: new mongoose.Types.ObjectId(driverId) };
    if (fromDate || toDate) {
      query.createdAt = {};
      if (fromDate) query.createdAt.$gte = fromDate;
      if (toDate) query.createdAt.$lte = toDate;
    }

    /*
     * Sorted by `createdAt` DESC then `_id` DESC. The tiebreak is not decoration: several entries
     * are written in one batch at trip completion and share a timestamp to the millisecond, so
     * without it the sort is unstable and a row can appear on two pages or none. `_id` is a
     * UUIDv7-adjacent ObjectId, so it orders by insertion.
     */
    const [entries, totalItems] = await Promise.all([
      DriverEarningModel.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      DriverEarningModel.countDocuments(query),
    ]);

    return {
      entries: entries.map((doc) => toEntity(doc.toObject() as DriverEarningDoc)),
      totalItems,
    };
  }

  /** Same sort as `pageForDriver`, or the two would disagree about which rows are "newer". */
  async sumMostRecentForDriver(driverId: string, count: number): Promise<number> {
    if (count <= 0 || !mongoose.isValidObjectId(driverId)) return 0;

    const [row] = await DriverEarningModel.aggregate<{ total: number }>([
      { $match: { driverId: new mongoose.Types.ObjectId(driverId) } },
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: count },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  async sumNewerThan(driverId: string, date: Date, id: string): Promise<number> {
    if (!mongoose.isValidObjectId(driverId) || !mongoose.isValidObjectId(id)) return 0;

    const [row] = await DriverEarningModel.aggregate<{ total: number }>([
      { $match: {
        driverId: new mongoose.Types.ObjectId(driverId),
        $or: [{ createdAt: { $gt: date } }, { createdAt: date, _id: { $gt: new mongoose.Types.ObjectId(id) } }]
      } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  async listForDriver(driverId: string, limit: number): Promise<LedgerEntry[]> {
    if (!mongoose.isValidObjectId(driverId)) return [];
    const docs = await DriverEarningModel.find({ driverId }).sort({ createdAt: -1 }).limit(limit);
    return docs.map((doc) => toEntity(doc.toObject() as DriverEarningDoc));
  }

  async listForBooking(bookingId: string): Promise<LedgerEntry[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];
    const docs = await DriverEarningModel.find({ bookingId }).sort({ createdAt: 1 });
    return docs.map((doc) => toEntity(doc.toObject() as DriverEarningDoc));
  }
}

/**
 * Reads a bulk-write failure that was ENTIRELY duplicate keys, returning whatever did get
 * written. Any other error — a connection drop, a validation failure — returns `null` and is
 * rethrown by the caller, because "some rows were rejected for a reason we did not check" must
 * never be reported to a completion handler as success.
 */
function asPartialInsertResult(error: unknown): LedgerEntry[] | null {
  if (typeof error !== 'object' || error === null) return null;

  const bulk = error as {
    code?: number;
    writeErrors?: Array<{ err?: { code?: number }; code?: number }>;
    insertedDocs?: DriverEarningDoc[];
  };

  const writeErrors = bulk.writeErrors ?? [];
  const everyErrorIsADuplicate =
    writeErrors.length > 0 &&
    writeErrors.every((e) => (e.err?.code ?? e.code) === DUPLICATE_KEY);

  if (!everyErrorIsADuplicate && bulk.code !== DUPLICATE_KEY) return null;

  return (bulk.insertedDocs ?? []).map(toEntity);
}
