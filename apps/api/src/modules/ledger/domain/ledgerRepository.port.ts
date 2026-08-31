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

  listForDriver(driverId: string, limit: number): Promise<LedgerEntry[]>;

  listForBooking(bookingId: string): Promise<LedgerEntry[]>;
}
