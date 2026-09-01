import type { LedgerEntry, NewLedgerEntry } from './domain/ledgerEntry.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `ledger`.
 *
 * APPEND AND READ, never edit. The contract cannot express a correction as a mutation, so a
 * caller that wants to fix a mistake has to append an `ADJUSTMENT` — which leaves both the error
 * and the fix in the history, and is the entire reason a ledger is a ledger.
 *
 * `bookings` is the consumer this exists for. It calls `append` from the `→ COMPLETED` and
 * `→ CANCELLED_*` side effects, after its own transaction has committed.
 */
export interface LedgerWriteContract {
  /**
   * Appends entries, idempotently for the once-per-booking types. Returns the rows actually
   * written — an empty array means every entry was already there, which is a successful retry
   * and not a failure.
   */
  append(entries: readonly NewLedgerEntry[]): Promise<LedgerEntry[]>;
}

export interface LedgerReadContract {
  /** Summed from the entries. The cache on `drivers` is not consulted and is not authoritative. */
  walletBalance(driverId: string): Promise<number>;
  /** The sum of positive rows only — what they have earned, before anything was paid back. */
  lifetimeEarnings(driverId: string): Promise<number>;
  entriesForBooking(bookingId: string): Promise<LedgerEntry[]>;
  recentEntriesForDriver(driverId: string, limit: number): Promise<LedgerEntry[]>;
}

export type LedgerPublicContract = LedgerWriteContract & LedgerReadContract;

export type { LedgerEntry, NewLedgerEntry, LedgerEntryType } from './domain/ledgerEntry.entity.js';
export { LEDGER_ENTRY_TYPES } from './domain/ledgerEntry.entity.js';
