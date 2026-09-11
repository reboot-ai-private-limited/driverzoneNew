import type {
  AdminDriverWalletDetailsDto,
  LedgerEntryDto,
  PayoutDto,
  TransactionType,
} from '@driverzone/contracts';
import type { LedgerEntry } from '../domain/ledgerEntry.entity.js';
import type { DriverWallet } from '../application/useCases/getDriverWallet.usecase.js';
import type { Payout } from '../domain/payout.entity.js';

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
  EXTENSION_EARNING: 'Extra day on a trip',
  COMMISSION_DEBIT: 'Commission',
  CASH_COLLECTED: 'Cash collected from customer',
  PAYOUT: 'Payout',
  DEBT_COLLECTED: 'Outstanding amount settled',
  ADJUSTMENT: 'Adjustment',
  PENALTY: 'Penalty',
  BONUS: 'Bonus',
};

/**
 * Builds the wallet DTO.
 *
 * THE RUNNING BALANCE IS COMPUTED, NOT STORED — and it is computed in the repository's query
 * rather than here. This function used to walk it back from an anchor, subtracting each row's
 * amount from the one before it; that is only correct while a page is a consecutive run of the
 * statement, which a filter breaks. The window sum arrives already attached to each row, so this
 * mapper now just renames fields, which is all a mapper should have been doing with money anyway.
 */
export function toWalletDto(
  driverId: string,
  wallet: DriverWallet,
  page: number,
  limit: number,
): AdminDriverWalletDetailsDto {
  const entries: LedgerEntryDto[] = wallet.entries.map((row) =>
    toEntryDto(driverId, row.entry, row.balanceAfterPaise),
  );

  return {
    wallet: {
      balance_paise: wallet.balancePaise,
      is_suspended_for_balance: wallet.isSuspendedForBalance,
      lifetime_earnings_paise: wallet.lifetimeEarningsPaise,
    },
    ledger: entries,
    summary: {
      credited_paise: wallet.totals.creditedPaise,
      debited_paise: wallet.totals.debitedPaise,
      net_paise: wallet.totals.creditedPaise - wallet.totals.debitedPaise,
      count: wallet.totals.count,
    },
    pagination: {
      page,
      limit,
      total_items: wallet.totalItems,
      total_pages: Math.max(1, Math.ceil(wallet.totalItems / limit)),
    },
  };
}

export function toEntryDto(driverId: string, entry: LedgerEntry, balanceAfter: number): LedgerEntryDto {
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

export function toPayoutDto(payout: Payout): PayoutDto {
  return {
    id: payout.id,
    driver_id: payout.driverId,
    amount_paise: payout.amountPaise,
    status: payout.status,
    utr: payout.utr,
    notes: payout.notes,
    created_at: payout.createdAt.toISOString(),
    processed_at: payout.processedAt ? payout.processedAt.toISOString() : null,
  };
}

