import mongoose from 'mongoose';
import type { LedgerEntry, NewLedgerEntry } from '../domain/ledgerEntry.entity.js';
import type {
  LedgerEntryWithBalance,
  LedgerQuery,
  LedgerRepositoryPort,
  LedgerTotals,
} from '../domain/ledgerRepository.port.js';
import { DriverEarningModel, type DriverEarningDoc } from './driverEarning.model.js';

/**
 * The filter half of a statement query, as a `$match` fragment.
 *
 * Kept separate from the driver match because the two are applied at DIFFERENT POINTS in
 * `pageForDriver`: the driver narrows the rows before the running balance is accumulated, the
 * filter narrows them after. Swapping them would compute the balance over the filtered subset,
 * which is the bug this whole shape exists to avoid.
 */
function toFilterMatch(query: LedgerQuery | undefined): Record<string, unknown> {
  if (query === undefined) return {};

  const match: Record<string, unknown> = {};
  if (query.types !== undefined && query.types.length > 0) {
    match['entryType'] = { $in: [...query.types] };
  }

  const createdAt: Record<string, Date> = {};
  if (query.from !== undefined) createdAt['$gte'] = query.from;
  // Exclusive, per the port — the controller has already moved an inclusive day to the next
  // midnight, so a row written at 23:59:59.999 on the `to` date is still inside the range.
  if (query.to !== undefined) createdAt['$lt'] = query.to;
  if (Object.keys(createdAt).length > 0) match['createdAt'] = createdAt;

  return match;
}

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

  /**
   * One page of the statement, each row carrying the balance the driver stood at after it.
   *
   * **The balance is a window function, not a walk back from the current total.** `$setWindowFields`
   * accumulates `amountPaise` oldest-to-newest across the driver's WHOLE statement, so every row
   * knows its own true balance before any filtering happens. The filter is applied after that, and
   * the page is cut after that — which is what lets "payouts in March" show the real balance at
   * each payout rather than a running total of payouts alone.
   *
   * Ordering: `createdAt` then `_id`, in both directions. The tiebreak is not decoration — several
   * entries are written in one batch at trip completion and share a timestamp to the millisecond,
   * so without it the sort is unstable and a row can appear on two pages or none. `_id` is a
   * UUIDv7-adjacent ObjectId, so it orders by insertion.
   *
   * COST: this reads and sorts the driver's whole ledger per page, where the old walk-back read
   * one page and one sum. That is the price of a correct balance under a filter, and it is bounded
   * by one driver's own history with `{ driverId, createdAt }` indexed. If a driver's statement
   * ever grows past what this can sort comfortably, the fix is a stored running balance written
   * under the same lock as the append — not a return to walking back.
   */
  async pageForDriver(
    driverId: string,
    page: number,
    limit: number,
    query?: LedgerQuery | undefined,
  ): Promise<{ entries: LedgerEntryWithBalance[]; totalItems: number }> {
    if (!mongoose.isValidObjectId(driverId)) return { entries: [], totalItems: 0 };

    const driverMatch = { driverId: new mongoose.Types.ObjectId(driverId) };
    const filterMatch = toFilterMatch(query);

    const rows = await DriverEarningModel.aggregate<
      DriverEarningDoc & { balanceAfterPaise: number }
    >([
      { $match: driverMatch },
      {
        $setWindowFields: {
          sortBy: { createdAt: 1, _id: 1 },
          output: {
            balanceAfterPaise: {
              $sum: '$amountPaise',
              window: { documents: ['unbounded', 'current'] },
            },
          },
        },
      },
      // AFTER the window, never before — see the header.
      ...(Object.keys(filterMatch).length > 0 ? [{ $match: filterMatch }] : []),
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: limit },
    ]);

    const totalItems = await DriverEarningModel.countDocuments({
      ...driverMatch,
      ...filterMatch,
    });

    return {
      entries: rows.map((row) => ({
        entry: toEntity(row),
        balanceAfterPaise: row.balanceAfterPaise,
      })),
      totalItems,
    };
  }

  /**
   * Credited, debited and count over everything the query selects.
   *
   * Two sums in one pass via `$cond` rather than two round trips, and `debited` comes back as a
   * POSITIVE magnitude — the DTO promises that, and negating at the edge means neither client has
   * to remember which way the sign points.
   */
  async totalsForDriver(driverId: string, query?: LedgerQuery | undefined): Promise<LedgerTotals> {
    if (!mongoose.isValidObjectId(driverId)) {
      return { creditedPaise: 0, debitedPaise: 0, count: 0 };
    }

    const [row] = await DriverEarningModel.aggregate<{
      credited: number;
      debited: number;
      count: number;
    }>([
      { $match: { driverId: new mongoose.Types.ObjectId(driverId), ...toFilterMatch(query) } },
      {
        $group: {
          _id: null,
          credited: {
            $sum: { $cond: [{ $gt: ['$amountPaise', 0] }, '$amountPaise', 0] },
          },
          debited: {
            $sum: { $cond: [{ $lt: ['$amountPaise', 0] }, { $abs: '$amountPaise' }, 0] },
          },
          count: { $sum: 1 },
        },
      },
    ]);

    return {
      creditedPaise: row?.credited ?? 0,
      debitedPaise: row?.debited ?? 0,
      count: row?.count ?? 0,
    };
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
