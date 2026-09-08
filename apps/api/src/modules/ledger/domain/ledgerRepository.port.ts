import type { LedgerEntry, LedgerEntryType, NewLedgerEntry } from './ledgerEntry.entity.js';

/**
 * Which rows a statement read selects. Every field absent means "the whole statement".
 *
 * `to` is an EXCLUSIVE instant even though the wire parameter names an inclusive day — the
 * controller turns `2026-09-04` into midnight on the 5th, so the whole of the 4th is included
 * without any row-level date arithmetic happening down here.
 */
export interface LedgerQuery {
  types?: readonly LedgerEntryType[] | undefined;
  from?: Date | undefined;
  /** Exclusive. */
  to?: Date | undefined;
}

/**
 * One statement row plus the balance the driver stood at once it had been applied.
 *
 * The balance rides WITH the row because it is computed in the same query — see
 * `pageForDriver`. Returning it separately would put the two out of step the moment a filter
 * meant the page was no longer a consecutive run of the statement.
 */
export interface LedgerEntryWithBalance {
  entry: LedgerEntry;
  balanceAfterPaise: number;
}

/** The totals for every row a query selects, not just the page returned. */
export interface LedgerTotals {
  creditedPaise: number;
  /** A positive magnitude, not a negative sum — see `LedgerSummaryDto`. */
  debitedPaise: number;
  count: number;
}

/** Where a driver's balance sits relative to zero. `SETTLED` is exactly zero. */
export type DriverBalanceState = 'ALL' | 'OWED_TO_COMPANY' | 'OWED_TO_DRIVER' | 'SETTLED';

export type DriverBalanceSort = 'BALANCE_ASC' | 'BALANCE_DESC' | 'LAST_ACTIVITY_DESC';

/**
 * Which drivers the collections screen selects.
 *
 * NO DATE RANGE, and that is deliberate rather than an omission: a balance is the sum of every
 * row a driver has ever had. "What did this driver owe in March" is a different question with a
 * different answer, and offering a date filter here would produce a number nobody could settle
 * against.
 */
export interface DriverBalanceQuery {
  /**
   * Restricts to these drivers — the result of a name/mobile search resolved by `identity`.
   *
   * `undefined` and `[]` MEAN DIFFERENT THINGS. Undefined is "no search, every driver"; an empty
   * array is "a search that matched nobody", which must return nothing rather than everybody.
   */
  driverIds?: readonly string[] | undefined;
  state?: DriverBalanceState | undefined;
  /** Applies to the OWED MAGNITUDE, so it only ever narrows drivers in debt. */
  minOwedPaise?: number | undefined;
  sort?: DriverBalanceSort | undefined;
  /**
   * A balance strictly below `-suspendedThresholdPaise` counts as suspended.
   *
   * A PLAIN NUMBER the caller supplies, not something this layer looks up. The threshold is a
   * setting, and a repository that read settings to answer a query would be a repository with an
   * opinion about policy. Passing it in keeps the count accurate across every page — which
   * counting in the caller could not do, since the caller only ever sees one page.
   */
  suspendedThresholdPaise?: number | undefined;
  /** Restrict to suspended drivers. Does nothing unless `suspendedThresholdPaise` is given. */
  suspendedOnly?: boolean | undefined;
}

/** One driver's standing, computed from their rows rather than read from a cached column. */
export interface DriverBalanceRow {
  driverId: string;
  balancePaise: number;
  lifetimeEarningsPaise: number;
  entryCount: number;
  lastEntryAt: Date;
}

/** Totals across every driver a `DriverBalanceQuery` selects, not just the page returned. */
export interface DriverBalanceAggregate {
  driversInDebt: number;
  totalOwedToCompanyPaise: number;
  driversInCredit: number;
  totalPayableToDriversPaise: number;
  /** Zero unless `suspendedThresholdPaise` was supplied — there is no threshold to count against. */
  suspendedCount: number;
  drivers: number;
}

/**
 * The feed filter — the same shape as `LedgerQuery` plus the ability to pin one driver.
 *
 * Separate from `LedgerQuery` because that one is always applied alongside a driver match the
 * caller supplies positionally; here the driver is part of the filter or absent entirely.
 */
export interface LedgerFeedQuery extends LedgerQuery {
  driverId?: string | undefined;
  /** As with `DriverBalanceQuery.driverIds`: undefined is "everyone", `[]` is "nobody". */
  driverIds?: readonly string[] | undefined;
}

/**
 * DOMAIN — what the ledger needs from storage, described without naming Mongo.
 *
 * Note there is no `update` and no `delete`, and that is the whole design: the port cannot
 * express a mutation, so no use case can accidentally offer one. Correcting a ledger means
 * appending an `ADJUSTMENT`, which leaves the mistake and the correction both visible.
 */
export interface LedgerRepositoryPort {
  /**
   * Inserts entries, skipping any that would duplicate a once-per-booking type.
   *
   * Returns only the rows actually written, so a retried trip completion returns `[]` rather than
   * failing — the caller learns "already done" instead of having to distinguish a real conflict
   * from a replay.
   */
  append(entries: readonly NewLedgerEntry[]): Promise<LedgerEntry[]>;

  /** The authoritative balance: the sum of every row for this driver. */
  sumForDriver(driverId: string): Promise<number>;

  /**
   * Everything the driver has ever been credited — the sum of POSITIVE rows only.
   *
   * Not the same question as the balance, and it is worth saying why they are separate: a driver
   * who has earned ₹4,00,000 and been paid out ₹3,90,000 has a balance of ₹10,000 and lifetime
   * earnings of ₹4,00,000. An admin looking at a wallet needs both, and neither derives from the
   * other.
   */
  sumEarningsForDriver(driverId: string): Promise<number>;

  listForDriver(driverId: string, limit: number): Promise<LedgerEntry[]>;

  /**
   * One page of a driver's statement, newest first, each row carrying the balance after it, plus
   * the total for the pager.
   *
   * THE BALANCE IS COMPUTED HERE, not walked back by the caller, and that is what makes `query`
   * safe. A walk-back subtracts each row's amount from the one before it, which is only correct
   * while the page is a consecutive run of the statement — precisely what a filter destroys. This
   * returns the cumulative sum over ALL of the driver's rows up to and including each returned
   * one, so a page of "payouts in March" still shows the real balance at each of those moments.
   *
   * `query` omitted means the whole statement.
   */
  pageForDriver(
    driverId: string,
    page: number,
    limit: number,
    query?: LedgerQuery | undefined,
  ): Promise<{ entries: LedgerEntryWithBalance[]; totalItems: number }>;

  /** Credited, debited and count for everything `query` selects — every page of it. */
  totalsForDriver(driverId: string, query?: LedgerQuery | undefined): Promise<LedgerTotals>;

  /**
   * The sum of all entries for a driver that are strictly newer than the given entry.
   * Used to anchor the running balance calculation correctly even when the history is filtered
   * by date ranges.
   */
  sumNewerThan(driverId: string, date: Date, id: string): Promise<number>;

  listForBooking(bookingId: string): Promise<LedgerEntry[]>;

  /**
   * The row a previous request with this key already wrote, if there is one.
   *
   * What turns a unique index from an error into idempotency: a replay finds the original and
   * returns it, so a double-tapped Settle reports the same settlement rather than a conflict.
   */
  findByIdempotencyKey(key: string): Promise<LedgerEntry | null>;

  /**
   * One page of the collections screen: every driver with ledger activity, and what they stand at.
   *
   * COMPUTED, NOT CACHED. `drivers.walletBalancePaise` exists and looks like the cheap answer, but
   * it has no writer anywhere in this codebase — a schema default of 0, one read in dispatch, and
   * nothing that ever sets it. Reading it here would print a confident zero beside a driver
   * holding several thousand rupees of company cash.
   *
   * A driver with NO rows does not appear. That is correct for a screen about who owes what —
   * they have never been owed anything and have never held company money — but it means this is
   * not a driver roster and must not be read as one.
   *
   * `totals` covers every driver the query selects, not the page, so the header figures do not
   * change as somebody pages through.
   */
  pageDriverBalances(
    query: DriverBalanceQuery,
    page: number,
    limit: number,
  ): Promise<{ rows: DriverBalanceRow[]; totals: DriverBalanceAggregate; totalItems: number }>;

  /**
   * One page of the ledger ACROSS DRIVERS, newest first — the finance feed.
   *
   * No running balance, unlike `pageForDriver`. A cumulative balance is a per-driver idea; over a
   * mixed feed it would be a number with no owner, and computing it would mean a window function
   * over the entire collection rather than one driver's slice.
   */
  pageAll(
    page: number,
    limit: number,
    query?: LedgerFeedQuery | undefined,
  ): Promise<{ entries: LedgerEntry[]; totalItems: number }>;

  /** Credited, debited and count for everything `pageAll` would select, every page of it. */
  totalsAll(query?: LedgerFeedQuery | undefined): Promise<LedgerTotals>;
}
