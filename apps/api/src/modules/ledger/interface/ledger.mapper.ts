import type {
  AdminDriverWalletDetailsDto,
  LedgerEntryDto,
  TransactionType,
} from '@driverzone/contracts';
import type { LedgerEntry } from '../domain/ledgerEntry.entity.js';
import type { DriverWallet } from '../application/useCases/getDriverWallet.usecase.js';

/**
 * Fallback prose for a row that carries no note of its own.
 *
 * `note` is required on `ADJUSTMENT` and `PENALTY` and optional elsewhere, so most rows written by
 * a trip have none. A generic phrase plus the `reference_id` beside it is enough for an admin to
 * follow — and it is honest, unlike inventing a booking reference this module cannot see: `ledger`
 * is tier 2 and `bookings` is tier 6, so it holds a booking id and never the `DZ-…` a customer
 * would quote. Callers that want a nicer line pass a `note`, which `bookings` now does.
 */
const FALLBACK_DESCRIPTION: Record<TransactionType, string> = {
  TRIP_EARNING: 'Trip earnings',
  WAITING_EARNING: 'Waiting time',
  COMMISSION_DEBIT: 'Commission',
  CASH_COLLECTED: 'Cash collected from customer',
  PAYOUT: 'Payout',
  ADJUSTMENT: 'Adjustment',
  PENALTY: 'Penalty',
  BONUS: 'Bonus',
};

/**
 * Builds the wallet DTO, deriving `balance_after_paise` for the page.
 *
 * THE RUNNING BALANCE IS COMPUTED, NOT STORED. Entries arrive newest-first from an anchor the use
 * case worked out — the current balance on page 1, and that minus everything newer on later pages
 * — and each older row's balance is the previous one with that row's own amount removed. Exact for
 * the rows returned, and it cannot drift from `SUM()`, which a per-row stored total eventually
 * would: several entries are appended together at trip completion and would race on reading the
 * previous balance.
 */
export function toWalletDto(
  driverId: string,
  wallet: DriverWallet,
  page: number,
  limit: number,
): AdminDriverWalletDetailsDto {
  let running = wallet.anchorBalancePaise;

  const entries: LedgerEntryDto[] = wallet.entries.map((entry) => {
    const balanceAfter = running;
    running -= entry.amountPaise;
    return toEntryDto(driverId, entry, balanceAfter);
  });

  return {
    wallet: {
      balance_paise: wallet.balancePaise,
      is_suspended_for_balance: wallet.isSuspendedForBalance,
      lifetime_earnings_paise: wallet.lifetimeEarningsPaise,
    },
    ledger: entries,
    pagination: {
      page,
      limit,
      total_items: wallet.totalItems,
      total_pages: Math.max(1, Math.ceil(wallet.totalItems / limit)),
    },
  };
}

function toEntryDto(driverId: string, entry: LedgerEntry, balanceAfter: number): LedgerEntryDto {
  return {
    id: entry.id,
    driver_id: driverId,
    type: entry.entryType,
    amount_paise: entry.amountPaise,
    balance_after_paise: balanceAfter,
    reference_id: entry.bookingId ?? entry.payoutId,
    description: entry.note ?? FALLBACK_DESCRIPTION[entry.entryType],
    created_at: entry.createdAt.toISOString(),
  };
}
