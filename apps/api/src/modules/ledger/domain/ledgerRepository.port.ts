import type { LedgerEntry, NewLedgerEntry } from './ledgerEntry.entity.js';

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

  /** One page of a driver's statement, newest first, with the total for the pager. */
  pageForDriver(
    driverId: string,
    page: number,
    limit: number,
  ): Promise<{ entries: LedgerEntry[]; totalItems: number }>;

  /**
   * The sum of the `count` most recent entries.
   *
   * Exists so a page of the statement can be anchored: the running balance shown beside the newest
   * row on page 3 is the current balance minus everything newer than it, and this is that
   * "everything newer" without re-fetching the rows themselves.
   */
  sumMostRecentForDriver(driverId: string, count: number): Promise<number>;

  listForBooking(bookingId: string): Promise<LedgerEntry[]>;
}
