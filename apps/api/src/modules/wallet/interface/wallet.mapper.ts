import type { CustomerWalletDto, WalletEntryDto } from '@driverzone/contracts';
import { toMoney } from '../../../shared/money/format.js';
import type { WalletEntry } from '../domain/walletEntry.entity.js';
import type { CustomerWalletView } from '../application/useCases/manageWallet.usecase.js';

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
