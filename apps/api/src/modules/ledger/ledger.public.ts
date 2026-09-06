import type { LedgerEntry, NewLedgerEntry } from './domain/ledgerEntry.entity.js';
import type { LedgerFeedQuery, LedgerTotals } from './domain/ledgerRepository.port.js';
import type {
  DriverBalancesInput,
  DriverBalancesPage,
} from './application/useCases/getDriverBalances.usecase.js';
import type {
  SettleDriverInput,
  SettlementResult,
} from './application/useCases/settleDriver.usecase.js';

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

/**
 * The cross-driver reads the admin finance surface needs.
 *
 * SEPARATE FROM `LedgerReadContract` on purpose, per Interface Segregation. `bookings` needs to
 * know one driver's balance; it has no business being handed a query that walks every driver in
 * the system. Only the tier-8 `admin` module takes this one.
 *
 * Both methods return DOMAIN types, not wire DTOs. Naming the driver, formatting the money and
 * deciding what an admin may see are the caller's job — this module knows about rows.
 */
export interface LedgerFinanceContract {
  /**
   * The collections view: drivers with ledger activity, and what each stands at.
   *
   * Computed from the rows. `drivers.walletBalancePaise` is not consulted — it has no writer
   * anywhere in this codebase and is permanently zero.
   */
  driverBalances(
    input: DriverBalancesInput,
    page: number,
    limit: number,
  ): Promise<DriverBalancesPage>;

  /**
   * Records a settlement against a driver, in whichever direction their balance stands.
   *
   * Appends exactly one row. The amount is a positive magnitude and is capped server-side at the
   * outstanding balance, recomputed at the moment of the write.
   */
  settleDriver(input: SettleDriverInput): Promise<SettlementResult>;

  /** One page of the ledger across every driver, newest first, plus the totals for the filter. */
  feed(
    page: number,
    limit: number,
    query?: LedgerFeedQuery | undefined,
  ): Promise<{ entries: LedgerEntry[]; totals: LedgerTotals; totalItems: number }>;
}

export type LedgerPublicContract = LedgerWriteContract & LedgerReadContract;

export type { LedgerEntry, NewLedgerEntry, LedgerEntryType } from './domain/ledgerEntry.entity.js';
export { LEDGER_ENTRY_TYPES } from './domain/ledgerEntry.entity.js';

/** Re-exported so `admin` can name what it passes and receives without reaching into `domain/`. */
export type {
  DriverBalanceSort,
  DriverBalanceState,
  LedgerFeedQuery,
  LedgerTotals,
} from './domain/ledgerRepository.port.js';
export type {
  DriverBalance,
  DriverBalancesInput,
  DriverBalancesPage,
} from './application/useCases/getDriverBalances.usecase.js';
