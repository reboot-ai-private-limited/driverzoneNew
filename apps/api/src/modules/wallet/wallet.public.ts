import type {
  NewWalletEntry,
  WalletApplication,
  WalletEntry,
} from './domain/walletEntry.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `wallet`.
 *
 * APPEND AND READ, never edit. The contract cannot express a correction as a mutation, so a
 * caller wanting to fix a mistake has to append an `ADJUSTMENT` — which leaves both the error and
 * the fix in the history, and is the whole reason this is a ledger rather than a number.
 *
 * `bookings` is the consumer this exists for: it asks `planFor` what the balance does to a fare
 * before creating a booking, and appends the resulting rows from the side effects afterwards.
 */
export interface WalletWriteContract {
  /**
   * Appends entries, idempotently for the once-per-booking types. Returns the rows actually
   * written — an empty array means every entry was already there, which is a successful retry and
   * not a failure.
   */
  append(entries: readonly NewWalletEntry[]): Promise<WalletEntry[]>;
}

export interface WalletReadContract {
  /** Signed, summed from the entries. Positive is credit the customer holds. */
  balance(customerId: string): Promise<number>;
  /** What this balance would do to a fare of `farePaise`. Writes nothing. */
  planFor(customerId: string, farePaise: number): Promise<WalletApplication>;
  entriesForBooking(bookingId: string): Promise<WalletEntry[]>;
}

export type WalletPublicContract = WalletWriteContract & WalletReadContract;

export type { WalletEntry, NewWalletEntry, WalletApplication } from './domain/walletEntry.entity.js';
export { applyWalletToFare } from './domain/walletEntry.entity.js';
