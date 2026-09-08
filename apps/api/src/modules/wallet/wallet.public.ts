import type {
  NewWalletEntry,
  WalletApplication,
  WalletEntry,
} from './domain/walletEntry.entity.js';
import type {
  CustomerWalletAggregate,
  CustomerWalletQuery,
  CustomerWalletRow,
} from './domain/walletRepository.port.js';

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

/**
 * The cross-customer read the admin finance surface needs.
 *
 * SEPARATE FROM `WalletReadContract`, per Interface Segregation and for the same reason
 * `LedgerFinanceContract` is separate: `bookings` needs one customer's balance to price a fare,
 * and has no business being handed a query that walks every customer in the system. Only the
 * tier-8 `admin` module takes this one.
 */
export interface WalletFinanceContract {
  /** Customers holding credit or carrying a fee, and the totals across the whole filter. */
  customerWallets(
    query: CustomerWalletQuery,
    page: number,
    limit: number,
  ): Promise<{ rows: CustomerWalletRow[]; totals: CustomerWalletAggregate; totalItems: number }>;
}

export type WalletPublicContract = WalletWriteContract & WalletReadContract;

export type { WalletEntry, NewWalletEntry, WalletApplication } from './domain/walletEntry.entity.js';
export { applyWalletToFare } from './domain/walletEntry.entity.js';

/** Re-exported so `admin` can name what it passes without reaching into `domain/`. */
export type {
  CustomerWalletAggregate,
  CustomerWalletQuery,
  CustomerWalletRow,
  CustomerWalletSort,
  CustomerWalletState,
} from './domain/walletRepository.port.js';
