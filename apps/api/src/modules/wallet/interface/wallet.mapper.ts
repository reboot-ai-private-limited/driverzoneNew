import type {
  AdminCustomerWalletDetailsDto,
  CustomerWalletDto,
  WalletEntryDto,
} from '@driverzone/contracts';
import { toMoney } from '../../../shared/money/format.js';
import type { WalletEntry } from '../domain/walletEntry.entity.js';
import type {
  CustomerWalletStatement,
  CustomerWalletView,
} from '../application/useCases/manageWallet.usecase.js';

export function toWalletEntryDto(entry: WalletEntry): WalletEntryDto {
  return {
    id: entry.id,
    entry_type: entry.entryType,
    amount: toMoney(entry.amountPaise),
    booking_id: entry.bookingId,
    note: entry.note,
    created_at: entry.createdAt.toISOString(),
  };
}

/**
 * The three figures a wallet screen needs, computed here rather than on four clients.
 *
 * `spendable_credit` and `amount_owed` are both derived from `balance`, and sending all three is
 * the point: a client deriving them itself could disagree about whether a negative balance is zero
 * credit or negative credit, and those two answers render very differently.
 */
export function toCustomerWalletDto(view: CustomerWalletView): CustomerWalletDto {
  return {
    balance: toMoney(view.balancePaise),
    spendable_credit: toMoney(Math.max(0, view.balancePaise)),
    amount_owed: toMoney(Math.max(0, -view.balancePaise)),
    entries: view.entries.map(toWalletEntryDto),
  };
}

/**
 * The admin statement: the same wallet, plus the totals and the pager.
 *
 * Built on `toCustomerWalletDto` rather than beside it, so the three money figures can never
 * disagree between the customer app's wallet screen and the admin's view of the same wallet.
 */
export function toAdminCustomerWalletDto(
  statement: CustomerWalletStatement,
): AdminCustomerWalletDetailsDto {
  return {
    ...toCustomerWalletDto(statement),
    summary: {
      credited_paise: statement.totals.creditedPaise,
      debited_paise: statement.totals.debitedPaise,
      net_paise: statement.totals.creditedPaise - statement.totals.debitedPaise,
      count: statement.totals.count,
    },
    pagination: {
      page: statement.page,
      limit: statement.limit,
      total_items: statement.totalItems,
      // `Math.max(1, …)`: an empty statement is one empty page, not zero pages — a pager told it
      // has zero pages renders "Page 1 of 0".
      total_pages: Math.max(1, Math.ceil(statement.totalItems / statement.limit)),
    },
  };
}
