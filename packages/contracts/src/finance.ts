/**
 * Finance and wallet wire types.
 *
 * Money is ALWAYS represented as integer paise.
 */

export const TRANSACTION_TYPES = [
  'TRIP_EARNING',
  'COMMISSION_DEDUCTION',
  'PAYOUT',
  'ADJUSTMENT',
  'PENALTY',
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
  /** The balance of the wallet immediately after this transaction was applied. */
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
