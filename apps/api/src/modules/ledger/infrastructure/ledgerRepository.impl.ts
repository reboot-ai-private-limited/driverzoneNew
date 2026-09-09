import mongoose from 'mongoose';
import type { LedgerEntry, NewLedgerEntry } from '../domain/ledgerEntry.entity.js';
import type {
  DriverBalanceAggregate,
  DriverBalanceQuery,
  DriverBalanceRow,
  DriverBalanceSort,
  LedgerEntryWithBalance,
  LedgerFeedQuery,
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

/**
 * The `$match` applied AFTER the `$group` in `pageDriverBalances`, selecting drivers by where
 * their balance landed. `null` means "no restriction".
 *
 * `minOwedPaise` narrows the DEBT side only. Asking for "everyone over ₹1,000" on a collections
 * screen means everyone owing more than that — a driver the company owes ₹2,000 is not a
 * collections problem, and returning them would make the filter useless for the job it exists for.
 */
function balanceStateMatch(query: DriverBalanceQuery): Record<string, unknown> | null {
  const clauses: Record<string, unknown>[] = [];

  switch (query.state) {
    case 'OWED_TO_COMPANY':
      clauses.push({ balancePaise: { $lt: 0 } });
      break;
    case 'OWED_TO_DRIVER':
      clauses.push({ balancePaise: { $gt: 0 } });
      break;
    case 'SETTLED':
      clauses.push({ balancePaise: 0 });
      break;
    default:
      break;
  }

  if (query.minOwedPaise !== undefined && query.minOwedPaise > 0) {
    clauses.push({ balancePaise: { $lte: -query.minOwedPaise } });
  }

  // Suspended is `balance < -threshold`, which on integers is `balance <= -(threshold + 1)`.
  if (query.suspendedOnly === true && query.suspendedThresholdPaise !== undefined) {
    clauses.push({ balancePaise: { $lt: -query.suspendedThresholdPaise } });
  }

  if (clauses.length === 0) return null;
  // `$and`, not a merged object: several clauses on `balancePaise` would otherwise overwrite one
  // another and silently drop most of the filter.
  return clauses.length === 1 ? (clauses[0] as Record<string, unknown>) : { $and: clauses };
}

function sortSpecFor(sort: DriverBalanceSort | undefined): Record<string, 1 | -1> {
  switch (sort) {
    case 'BALANCE_DESC':
      return { balancePaise: -1, _id: 1 };
    case 'LAST_ACTIVITY_DESC':
      return { lastEntryAt: -1, _id: 1 };
    // Deepest debt first — the working order for a collections screen, so it is the default.
    default:
      return { balancePaise: 1, _id: 1 };
  }
}

/**
 * The feed's `$match`. `null` means "this query can match nothing" — a search that resolved to no
 * drivers — which is different from an empty filter and must not be collapsed into one.
 */
function feedMatch(query: LedgerFeedQuery | undefined): Record<string, unknown> | null {
  const match: Record<string, unknown> = toFilterMatch(query);

  if (query?.driverId !== undefined) {
    if (!mongoose.isValidObjectId(query.driverId)) return null;
    match['driverId'] = new mongoose.Types.ObjectId(query.driverId);
    return match;
  }

  if (query?.driverIds !== undefined) {
    const ids = query.driverIds
      .filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    if (ids.length === 0) return null;
    match['driverId'] = { $in: ids };
  }

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
    idempotencyKey: doc.idempotencyKey ?? null,
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
      idempotencyKey: entry.idempotencyKey ?? null,
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

  /**
   * The collections screen. See the port for why this aggregates rather than reading the cache.
   *
   * ONE ROUND TRIP via `$facet` — the page, the totals across every matching driver, and the
   * driver count all come back together. A `countDocuments` alongside would be worse than
   * redundant: it counts ROWS, and this pager counts DRIVERS, so it would report a number several
   * times too large and the pager would offer pages that do not exist.
   */
  async pageDriverBalances(
    query: DriverBalanceQuery,
    page: number,
    limit: number,
  ): Promise<{ rows: DriverBalanceRow[]; totals: DriverBalanceAggregate; totalItems: number }> {
    const empty = {
      rows: [],
      totals: {
        driversInDebt: 0,
        totalOwedToCompanyPaise: 0,
        driversInCredit: 0,
        totalPayableToDriversPaise: 0,
        suspendedCount: 0,
        drivers: 0,
      },
      totalItems: 0,
    };

    // `[]` is a search that matched nobody. Falling through would drop the `$match` and return
    // every driver — the exact opposite of what was asked.
    if (query.driverIds !== undefined && query.driverIds.length === 0) return empty;

    const ids = query.driverIds
      ?.filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    // Narrowing BEFORE the group so the `{ driverId, createdAt }` index can be used.
    const preMatch = ids === undefined ? [] : [{ $match: { driverId: { $in: ids } } }];

    const stateMatch = balanceStateMatch(query);

    const [result] = await DriverEarningModel.aggregate<{
      rows: Array<{ _id: mongoose.Types.ObjectId } & Omit<DriverBalanceRow, 'driverId'>>;
      totals: Array<Omit<DriverBalanceAggregate, 'drivers'> & { drivers: number }>;
    }>(
      [
        ...preMatch,
        {
          $group: {
            _id: '$driverId',
            balancePaise: { $sum: '$amountPaise' },
            lifetimeEarningsPaise: {
              $sum: { $cond: [{ $gt: ['$amountPaise', 0] }, '$amountPaise', 0] },
            },
            entryCount: { $sum: 1 },
            lastEntryAt: { $max: '$createdAt' },
          },
        },
        ...(stateMatch === null ? [] : [{ $match: stateMatch }]),
        {
          $facet: {
            rows: [
              // COMPOUND sort. The `_id` tiebreak is what stops a driver whose balance ties with
              // another from appearing on two pages, or on none — the same reason
              // `pageForDriver` tiebreaks on `_id`.
              { $sort: sortSpecFor(query.sort) },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  driversInDebt: { $sum: { $cond: [{ $lt: ['$balancePaise', 0] }, 1, 0] } },
                  totalOwedToCompanyPaise: {
                    $sum: {
                      $cond: [{ $lt: ['$balancePaise', 0] }, { $abs: '$balancePaise' }, 0],
                    },
                  },
                  driversInCredit: { $sum: { $cond: [{ $gt: ['$balancePaise', 0] }, 1, 0] } },
                  suspendedCount: {
                    $sum: {
                      $cond: [
                        // Zero when no threshold was supplied — there is nothing to be past.
                        { $lt: ['$balancePaise', -(query.suspendedThresholdPaise ?? Infinity)] },
                        1,
                        0,
                      ],
                    },
                  },
                  totalPayableToDriversPaise: {
                    $sum: { $cond: [{ $gt: ['$balancePaise', 0] }, '$balancePaise', 0] },
                  },
                  drivers: { $sum: 1 },
                },
              },
            ],
          },
        },
      ],
      // A grouping over the whole collection can exceed the 100MB in-memory limit once this has
      // years of rows in it. The escape hatch when that is not enough is a materialised balances
      // collection, not a bigger limit.
      { allowDiskUse: true },
    );

    const totals = result?.totals[0];

    return {
      rows: (result?.rows ?? []).map((row) => ({
        driverId: String(row._id),
        balancePaise: row.balancePaise,
        lifetimeEarningsPaise: row.lifetimeEarningsPaise,
        entryCount: row.entryCount,
        lastEntryAt: row.lastEntryAt,
      })),
      totals: {
        driversInDebt: totals?.driversInDebt ?? 0,
        totalOwedToCompanyPaise: totals?.totalOwedToCompanyPaise ?? 0,
        driversInCredit: totals?.driversInCredit ?? 0,
        suspendedCount: totals?.suspendedCount ?? 0,
        totalPayableToDriversPaise: totals?.totalPayableToDriversPaise ?? 0,
        drivers: totals?.drivers ?? 0,
      },
      totalItems: totals?.drivers ?? 0,
    };
  }

  async pageAll(
    page: number,
    limit: number,
    query?: LedgerFeedQuery | undefined,
  ): Promise<{ entries: LedgerEntry[]; totalItems: number }> {
    const match = feedMatch(query);
    if (match === null) return { entries: [], totalItems: 0 };

    const [docs, totalItems] = await Promise.all([
      DriverEarningModel.find(match)
        // `_id` tiebreak again: two rows written in the same millisecond (a trip completion writes
        // TRIP_EARNING and CASH_COLLECTED together) would otherwise page unstably.
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      DriverEarningModel.countDocuments(match).exec(),
    ]);

    return { entries: docs.map((doc) => toEntity(doc as DriverEarningDoc)), totalItems };
  }

  async totalsAll(query?: LedgerFeedQuery | undefined): Promise<LedgerTotals> {
    const match = feedMatch(query);
    if (match === null) return { creditedPaise: 0, debitedPaise: 0, count: 0 };

    const [row] = await DriverEarningModel.aggregate<{
      credited: number;
      debited: number;
      count: number;
    }>([
      { $match: match },
      {
        $group: {
          _id: null,
          credited: { $sum: { $cond: [{ $gt: ['$amountPaise', 0] }, '$amountPaise', 0] } },
          debited: { $sum: { $cond: [{ $lt: ['$amountPaise', 0] }, { $abs: '$amountPaise' }, 0] } },
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

  async findByIdempotencyKey(key: string): Promise<LedgerEntry | null> {
    const doc = await DriverEarningModel.findOne({ idempotencyKey: key }).lean().exec();
    return doc === null ? null : toEntity(doc as DriverEarningDoc);
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
