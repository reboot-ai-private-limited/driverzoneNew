import mongoose from 'mongoose';
import type { NewWalletEntry, WalletEntry } from '../domain/walletEntry.entity.js';
import type {
  CustomerWalletAggregate,
  CustomerWalletQuery,
  CustomerWalletRow,
  CustomerWalletSort,
  CustomerWalletState,
  WalletQuery,
  WalletRepositoryPort,
  WalletTotals,
} from '../domain/walletRepository.port.js';
import { WalletEntryModel, type WalletEntryDoc } from './walletEntry.model.js';

/** The filter half of a statement query. Mirrors the ledger's `toFilterMatch`. */
function toFilterMatch(query: WalletQuery | undefined): Record<string, unknown> {
  if (query === undefined) return {};

  const match: Record<string, unknown> = {};
  if (query.types !== undefined && query.types.length > 0) {
    match['entryType'] = { $in: [...query.types] };
  }

  const createdAt: Record<string, Date> = {};
  if (query.from !== undefined) createdAt['$gte'] = query.from;
  // Exclusive, per the port — the controller has already moved an inclusive day forward.
  if (query.to !== undefined) createdAt['$lt'] = query.to;
  if (Object.keys(createdAt).length > 0) match['createdAt'] = createdAt;

  return match;
}

/**
 * Selects customers by where their balance landed. `null` means no restriction.
 *
 * THE SIGNS ARE THE MIRROR of the driver ledger's. Here positive means the company owes the
 * customer (they hold credit) and negative means they owe us (an unpaid cancellation fee) — the
 * opposite of a driver, whose negative balance means they are holding our cash.
 */
function walletStateMatch(state: CustomerWalletState | undefined): Record<string, unknown> | null {
  switch (state) {
    case 'IN_CREDIT':
      return { balancePaise: { $gt: 0 } };
    case 'IN_DEBT':
      return { balancePaise: { $lt: 0 } };
    case 'SETTLED':
      return { balancePaise: 0 };
    default:
      return null;
  }
}

function walletSortSpec(sort: CustomerWalletSort | undefined): Record<string, 1 | -1> {
  switch (sort) {
    case 'BALANCE_ASC':
      return { balancePaise: 1, _id: 1 };
    case 'LAST_ACTIVITY_DESC':
      return { lastEntryAt: -1, _id: 1 };
    // Most credit held first — the liability worth looking at, so it is the default.
    default:
      return { balancePaise: -1, _id: 1 };
  }
}

function toEntity(doc: WalletEntryDoc): WalletEntry {
  return {
    id: String(doc._id),
    customerId: String(doc.customerId),
    bookingId: doc.bookingId ? String(doc.bookingId) : null,
    entryType: doc.entryType as WalletEntry['entryType'],
    amountPaise: doc.amountPaise,
    note: doc.note ?? null,
    createdAt: doc.createdAt,
  };
}

/** Mongo's duplicate-key error, which is how the idempotency index reports a replay. */
const DUPLICATE_KEY = 11000;

export class MongoWalletRepository implements WalletRepositoryPort {
  /**
   * `ordered: false` so one duplicate does not abandon the rest of the batch.
   *
   * A booking can write two rows at once — spending credit and clearing a debt never happen
   * together, but a cancellation writes a fee while a retry may find it already there. Ordered,
   * the first duplicate stops the batch and the remaining entries are silently lost. Unordered,
   * Mongo attempts all of them and reports the duplicates, which are then read as "already
   * written" rather than as a failure.
   */
  async append(entries: readonly NewWalletEntry[]): Promise<WalletEntry[]> {
    if (entries.length === 0) return [];

    const docs = entries.map((entry) => ({
      customerId: new mongoose.Types.ObjectId(entry.customerId),
      bookingId: entry.bookingId ? new mongoose.Types.ObjectId(entry.bookingId) : null,
      entryType: entry.entryType,
      amountPaise: entry.amountPaise,
      note: entry.note ?? null,
    }));

    try {
      const written = await WalletEntryModel.insertMany(docs, { ordered: false });
      return written.map((doc) => toEntity(doc.toObject() as WalletEntryDoc));
    } catch (error) {
      const result = asPartialInsertResult(error);
      if (result === null) throw error;
      return result;
    }
  }

  async sumForCustomer(customerId: string): Promise<number> {
    if (!mongoose.isValidObjectId(customerId)) return 0;

    const [row] = await WalletEntryModel.aggregate<{ total: number }>([
      { $match: { customerId: new mongoose.Types.ObjectId(customerId) } },
      { $group: { _id: null, total: { $sum: '$amountPaise' } } },
    ]);

    return row?.total ?? 0;
  }

  async listForCustomer(customerId: string, limit: number): Promise<WalletEntry[]> {
    if (!mongoose.isValidObjectId(customerId)) return [];

    const docs = await WalletEntryModel.find({
      customerId: new mongoose.Types.ObjectId(customerId),
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return docs.map((doc) => toEntity(doc as WalletEntryDoc));
  }

  async pageForCustomer(
    customerId: string,
    page: number,
    limit: number,
    query?: WalletQuery | undefined,
  ): Promise<{ entries: WalletEntry[]; totalItems: number }> {
    if (!mongoose.isValidObjectId(customerId)) return { entries: [], totalItems: 0 };

    const match = {
      customerId: new mongoose.Types.ObjectId(customerId),
      ...toFilterMatch(query),
    };

    const [docs, totalItems] = await Promise.all([
      WalletEntryModel.find(match)
        // `_id` tiebreak: a booking side effect writes several rows in the same millisecond, and
        // without it they would page unstably.
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      WalletEntryModel.countDocuments(match).exec(),
    ]);

    return { entries: docs.map((doc) => toEntity(doc as WalletEntryDoc)), totalItems };
  }

  async totalsForCustomer(
    customerId: string,
    query?: WalletQuery | undefined,
  ): Promise<WalletTotals> {
    if (!mongoose.isValidObjectId(customerId)) {
      return { creditedPaise: 0, debitedPaise: 0, count: 0 };
    }

    const [row] = await WalletEntryModel.aggregate<{
      credited: number;
      debited: number;
      count: number;
    }>([
      {
        $match: {
          customerId: new mongoose.Types.ObjectId(customerId),
          ...toFilterMatch(query),
        },
      },
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

  /**
   * Customers by balance — the mirror of the ledger's `pageDriverBalances`, including the
   * `$facet` that returns the page, the totals and the customer count in one round trip.
   */
  async pageCustomerWallets(
    query: CustomerWalletQuery,
    page: number,
    limit: number,
  ): Promise<{ rows: CustomerWalletRow[]; totals: CustomerWalletAggregate; totalItems: number }> {
    const empty = {
      rows: [],
      totals: {
        customersInDebt: 0,
        totalOwedByCustomersPaise: 0,
        customersInCredit: 0,
        totalCreditOutstandingPaise: 0,
        customers: 0,
      },
      totalItems: 0,
    };

    // A search that matched nobody. Falling through would return every customer instead.
    if (query.customerIds !== undefined && query.customerIds.length === 0) return empty;

    const ids = query.customerIds
      ?.filter((id) => mongoose.isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const stateMatch = walletStateMatch(query.state);

    const [result] = await WalletEntryModel.aggregate<{
      rows: Array<{ _id: mongoose.Types.ObjectId } & Omit<CustomerWalletRow, 'customerId'>>;
      totals: CustomerWalletAggregate[];
    }>(
      [
        ...(ids === undefined ? [] : [{ $match: { customerId: { $in: ids } } }]),
        {
          $group: {
            _id: '$customerId',
            balancePaise: { $sum: '$amountPaise' },
            entryCount: { $sum: 1 },
            lastEntryAt: { $max: '$createdAt' },
          },
        },
        ...(stateMatch === null ? [] : [{ $match: stateMatch }]),
        {
          $facet: {
            rows: [
              // Compound sort — the `_id` tiebreak stops a customer whose balance ties with
              // another from appearing on two pages, or on none.
              { $sort: walletSortSpec(query.sort) },
              { $skip: (page - 1) * limit },
              { $limit: limit },
            ],
            totals: [
              {
                $group: {
                  _id: null,
                  customersInDebt: { $sum: { $cond: [{ $lt: ['$balancePaise', 0] }, 1, 0] } },
                  totalOwedByCustomersPaise: {
                    $sum: { $cond: [{ $lt: ['$balancePaise', 0] }, { $abs: '$balancePaise' }, 0] },
                  },
                  customersInCredit: { $sum: { $cond: [{ $gt: ['$balancePaise', 0] }, 1, 0] } },
                  totalCreditOutstandingPaise: {
                    $sum: { $cond: [{ $gt: ['$balancePaise', 0] }, '$balancePaise', 0] },
                  },
                  customers: { $sum: 1 },
                },
              },
            ],
          },
        },
      ],
      { allowDiskUse: true },
    );

    const totals = result?.totals[0];

    return {
      rows: (result?.rows ?? []).map((row) => ({
        customerId: String(row._id),
        balancePaise: row.balancePaise,
        entryCount: row.entryCount,
        lastEntryAt: row.lastEntryAt,
      })),
      totals: {
        customersInDebt: totals?.customersInDebt ?? 0,
        totalOwedByCustomersPaise: totals?.totalOwedByCustomersPaise ?? 0,
        customersInCredit: totals?.customersInCredit ?? 0,
        totalCreditOutstandingPaise: totals?.totalCreditOutstandingPaise ?? 0,
        customers: totals?.customers ?? 0,
      },
      totalItems: totals?.customers ?? 0,
    };
  }

  async listForBooking(bookingId: string): Promise<WalletEntry[]> {
    if (!mongoose.isValidObjectId(bookingId)) return [];

    const docs = await WalletEntryModel.find({
      bookingId: new mongoose.Types.ObjectId(bookingId),
    })
      .sort({ createdAt: 1 })
      .lean();

    return docs.map((doc) => toEntity(doc as WalletEntryDoc));
  }
}

/**
 * Reads a bulk-insert failure that is ENTIRELY duplicates as a successful replay.
 *
 * Anything else — a validation failure, a lost connection — is rethrown, because "some rows did
 * not write" is only safe to ignore when the reason is that they were already there.
 */
function asPartialInsertResult(error: unknown): WalletEntry[] | null {
  if (typeof error !== 'object' || error === null) return null;

  const bulk = error as {
    code?: number;
    writeErrors?: Array<{ err?: { code?: number }; code?: number }>;
    insertedDocs?: WalletEntryDoc[];
  };

  const writeErrors = bulk.writeErrors ?? [];
  const everyErrorIsADuplicate =
    writeErrors.length > 0 && writeErrors.every((e) => (e.err?.code ?? e.code) === DUPLICATE_KEY);

  if (!everyErrorIsADuplicate && bulk.code !== DUPLICATE_KEY) return null;

  return (bulk.insertedDocs ?? []).map(toEntity);
}
