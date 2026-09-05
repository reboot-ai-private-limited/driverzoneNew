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

  listForBooking(bookingId: string): Promise<LedgerEntry[]>;
}
