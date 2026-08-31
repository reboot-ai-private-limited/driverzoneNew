/**
 * Finance and wallet wire types.
 *
 * Money is ALWAYS represented as integer paise.
 */

/**
 * Every kind of row the driver ledger holds.
 *
 * THIS LIST IS THE PERSISTED ENUM. It mirrors `LEDGER_ENTRY_TYPES` in the API's `ledger` module
 * exactly, and a `ledger.typecheck.ts` fails the build if the two ever drift — because they are
 * not two lists, they are one list written down twice, and a wire enum missing a value the
 * database can produce renders that row as an unknown string on the one screen that exists to
 * explain it.
 *
 * `CASH_COLLECTED` is the load-bearing one. It is NEGATIVE: a driver who took a cash fare is
 * holding the company's money, so it counts against what they are owed, and it is the entry that
 * makes a driver's balance go into debt at all.
 */
export const TRANSACTION_TYPES = [
  /** The driver's share of a completed trip. Positive. */
  'TRIP_EARNING',
  /** Waiting time the customer paid for, credited to the driver IN FULL, uncommissioned. Positive. */
  'WAITING_EARNING',
  /** Commission taken separately, where it was not already netted off. Negative. */
  'COMMISSION_DEBIT',
  /** Cash the driver took from a customer. Negative — they are holding company money. */
  'CASH_COLLECTED',
  /** A settlement paid out to the driver. Negative: it discharges a balance owed. */
  'PAYOUT',
  /** A manual correction by an admin. Either sign, always with a reason. */
  'ADJUSTMENT',
  /** A late fine or a cancellation penalty. Negative. */
  'PENALTY',
  /** An incentive. Positive. */
  'BONUS',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface WalletBalanceDto {
  /** The driver's current balance in integer paise. Negative means the driver owes the company. */
  balance_paise: number;
  /** True if the driver's balance has dropped below the negative threshold, halting dispatch. */
  is_suspended_for_balance: boolean;
  /** Total lifetime earnings (paise) */
  lifetime_earnings_paise: number;
}

export interface LedgerEntryDto {
  id: string;
  driver_id: string;
  type: TransactionType;
  /** Amount in integer paise. Positive means added to driver's wallet, negative means deducted. */
  amount_paise: number;
  /**
   * The balance immediately after this row was applied.
   *
   * DERIVED, NOT STORED. The ledger is append-only signed amounts and the balance is their sum;
   * a running total written per row would need serialised appends per driver and could drift from
   * `SUM()`, which the LLD is explicit must never happen. The server computes this per page by
   * taking the true balance and walking newest-to-oldest, so it is exact for the rows returned.
   */
  balance_after_paise: number;
  /** Optional reference to the entity that caused this (e.g., Booking ID or Payout Batch ID) */
  reference_id: string | null;
  /** Human-readable description (e.g., "Trip earnings for DZ-8F3K2M") */
  description: string;
  created_at: string;
}

export interface AdminDriverWalletDetailsDto {
  wallet: WalletBalanceDto;
  ledger: LedgerEntryDto[];
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}
