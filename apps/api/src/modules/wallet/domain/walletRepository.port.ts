import type { NewWalletEntry, WalletEntry } from './walletEntry.entity.js';

/**
 * DOMAIN — what the customer wallet needs from storage, described without naming Mongo.
 *
 * There is no `update` and no `delete`, and that is the design rather than an omission: the port
 * cannot express a mutation, so no use case can offer one. Fixing a wrong row means appending an
 * `ADJUSTMENT`, which leaves the mistake and the correction both readable.
 */
export interface WalletRepositoryPort {
  /**
   * Inserts entries, skipping any that would duplicate a once-per-booking type.
   *
   * Returns only the rows actually written, so a retried booking side effect returns `[]` rather
   * than failing — the caller learns "already done" instead of having to tell a replay apart from
   * a real conflict.
   */
  append(entries: readonly NewWalletEntry[]): Promise<WalletEntry[]>;

  /** The authoritative balance: the sum of every row for this customer. */
  sumForCustomer(customerId: string): Promise<number>;

  listForCustomer(customerId: string, limit: number): Promise<WalletEntry[]>;

  listForBooking(bookingId: string): Promise<WalletEntry[]>;
}
