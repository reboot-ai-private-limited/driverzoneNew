import {
  TRANSACTION_TYPE_LABELS,
  type DriverBalanceRowDto,
  type DriverBalanceTotalsDto,
  type CustomerWalletRowDto,
  type FinanceTransactionDto,
  type TransactionType,
} from '@driverzone/contracts';
import { toMoney } from '../../../shared/money/format.js';
import type {
  DriverBalance,
  DriverBalancesPage,
  LedgerEntry,
} from '../../ledger/ledger.public.js';
import type { CustomerWalletRow } from '../../wallet/wallet.public.js';

/** What the caller resolved about a driver, from `identity`. Absent for a deleted account. */
export interface DriverIdentity {
  fullName: string | null;
  phone: string | null;
}

/**
 * One driver's standing, as the collections screen reads it.
 *
 * `owed_to_company` and `payable_to_driver` are `balance` split by sign, sent as MAGNITUDES.
 * Derived here rather than in each client because there are four readers of this figure — the
 * table, the totals row, the CSV export and the printed report — and a minus sign that four
 * places each decide how to interpret is a minus sign that will eventually point the wrong way
 * in one of them.
 */
export function toDriverBalanceRowDto(
  row: DriverBalance,
  identity: DriverIdentity | undefined,
): DriverBalanceRowDto {
  return {
    driver_id: row.driverId,
    name: identity?.fullName ?? null,
    phone: identity?.phone ?? null,
    balance: toMoney(row.balancePaise),
    owed_to_company: toMoney(row.balancePaise < 0 ? -row.balancePaise : 0),
    payable_to_driver: toMoney(row.balancePaise > 0 ? row.balancePaise : 0),
    lifetime_earnings: toMoney(row.lifetimeEarningsPaise),
    is_suspended_for_balance: row.isSuspendedForBalance,
    last_entry_at: row.lastEntryAt.toISOString(),
    entry_count: row.entryCount,
  };
}

export function toDriverBalanceTotalsDto(
  totals: DriverBalancesPage['totals'],
): DriverBalanceTotalsDto {
  return {
    drivers_in_debt: totals.driversInDebt,
    total_owed_to_company: toMoney(totals.totalOwedToCompanyPaise),
    drivers_in_credit: totals.driversInCredit,
    total_payable_to_drivers: toMoney(totals.totalPayableToDriversPaise),
    suspended_count: totals.suspendedCount,
    drivers: totals.drivers,
  };
}

/**
 * WHICH WAY VALUE MOVED, from the company's side — normalised so one table can hold two ledgers
 * that write their signs from opposite sides.
 *
 * PER TYPE, NOT PER SIGN, and that distinction is load-bearing. The obvious implementation is
 * "negative amount means money toward the company", and it is wrong for precisely the two rows
 * that describe cash actually changing hands:
 *
 *   - `DEBT_COLLECTED` is POSITIVE (it raises the driver's balance toward zero) but the company
 *     has just been handed cash — unmistakably IN.
 *   - `PAYOUT` is NEGATIVE (it lowers the balance toward zero) but the company has just paid cash
 *     out — unmistakably OUT.
 *
 * A sign rule labels both backwards, and an ops person reading "Debt collected · Out" would
 * rightly conclude the table is broken.
 *
 * The rule instead: does this row put value in the company's hands (IN) or take it out (OUT)?
 * `CASH_COLLECTED` is IN because the fare belongs to the company the moment it is taken, even
 * though the driver is physically holding it; `TRIP_EARNING` is OUT because it is the driver's
 * share of that fare. Accrual and settlement rows therefore share a direction, which is what
 * makes the column summable in the reader's head.
 */
const DIRECTION_BY_TYPE: Record<TransactionType, FinanceTransactionDto['direction']> = {
  /** The company's fare, taken at the kerb. */
  CASH_COLLECTED: 'IN',
  /** The company's cut. */
  COMMISSION_DEBIT: 'IN',
  /** Charged to the driver. */
  PENALTY: 'IN',
  /** The driver handing back what they were holding. */
  DEBT_COLLECTED: 'IN',
  /** The driver's share of a fare. */
  TRIP_EARNING: 'OUT',
  /** The driver's share of an extra day the customer bought mid-trip. */
  EXTENSION_EARNING: 'OUT',
  WAITING_EARNING: 'OUT',
  BONUS: 'OUT',
  /** Cash leaving the company for the driver. */
  PAYOUT: 'OUT',
  /** Either sign by definition, so this one alone is decided by the amount. */
  ADJUSTMENT: 'NEUTRAL',
};

function directionForDriverRow(
  entryType: TransactionType,
  amountPaise: number,
): FinanceTransactionDto['direction'] {
  const fixed = DIRECTION_BY_TYPE[entryType];
  if (fixed !== 'NEUTRAL') return fixed;

  // `ADJUSTMENT` only. A correction that raises the driver's balance costs the company; one that
  // lowers it recovers something.
  if (amountPaise > 0) return 'OUT';
  if (amountPaise < 0) return 'IN';
  return 'NEUTRAL';
}

export function toFinanceTransactionDto(
  entry: LedgerEntry,
  identity: DriverIdentity | undefined,
): FinanceTransactionDto {
  return {
    id: entry.id,
    party: { kind: 'DRIVER', id: entry.driverId, name: identity?.fullName ?? null },
    type: entry.entryType,
    // Resolved server-side so one table can render rows from two enums without knowing either.
    type_label: TRANSACTION_TYPE_LABELS[entry.entryType] ?? entry.entryType,
    amount: toMoney(entry.amountPaise),
    direction: directionForDriverRow(entry.entryType, entry.amountPaise),
    booking_id: entry.bookingId,
    note: entry.note,
    created_at: entry.createdAt.toISOString(),
  };
}

/**
 * One customer's wallet standing.
 *
 * THE SIGNS MIRROR `toDriverBalanceRowDto`, which is why they are split into named magnitudes
 * here too — but the other way round. A customer's positive balance is credit the company owes
 * THEM; a driver's positive balance is also money we owe, but a driver's NEGATIVE balance means
 * they are holding our cash, whereas a customer's negative balance means they owe us a fee.
 * Naming both sides explicitly is what stops a reader having to remember which ledger they are
 * looking at.
 */
export function toCustomerWalletRowDto(
  row: CustomerWalletRow,
  identity: DriverIdentity | undefined,
): CustomerWalletRowDto {
  return {
    customer_id: row.customerId,
    name: identity?.fullName ?? null,
    phone: identity?.phone ?? null,
    balance: toMoney(row.balancePaise),
    spendable_credit: toMoney(row.balancePaise > 0 ? row.balancePaise : 0),
    amount_owed: toMoney(row.balancePaise < 0 ? -row.balancePaise : 0),
    last_entry_at: row.lastEntryAt.toISOString(),
    entry_count: row.entryCount,
  };
}
