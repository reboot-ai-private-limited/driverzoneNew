import type { Money } from './http.js';

/**
 * The CUSTOMER's wallet — coupon credit they hold, and charges they owe.
 *
 * ONE SIGNED BALANCE, NOT TWO BUCKETS. Credit and debt are rows in the same ledger and net
 * against each other, so a ₹50 credit does cancel a ₹50 fine. That is a deliberate choice
 * (2026-09-02): it keeps one number on the screen and one number in the booking maths, at the
 * cost of a granted credit being able to absorb a penalty. If penalties ever need to be
 * un-absorbable, they become a second balance here rather than a flag on these rows.
 *
 * MIRRORS THE DRIVER LEDGER (`TRANSACTION_TYPES`, docs/LLD/pricing-and-commission.md §The
 * ledger) and for the same reasons: append-only, signed, no update and no delete, balance is the
 * SUM of the rows. A correction is another row. `customers.walletBalancePaise` is a cache of that
 * sum and is never the source of truth.
 *
 * SIGN CONVENTION, from the CUSTOMER's side: positive means the company owes them (spendable
 * credit), negative means they owe the company. It is the opposite way round from how an
 * accountant would write it and the same way round as how the customer reads it, which is what
 * the screen showing it needs.
 */
export const WALLET_ENTRY_TYPES = [
  /** Credit granted by an admin — a coupon, a goodwill gesture, a refund made as credit. */
  'CREDIT_GRANT',
  /** A cancellation fee the customer was charged and has not yet paid. */
  'CANCELLATION_FEE',
  /** Any other penalty an admin imposes. Requires a note. */
  'FINE',
  /** Credit consumed by a booking, reducing what that trip cost. */
  'SPENT_ON_RIDE',
  /**
   * Credit handed back because the trip never happened.
   *
   * The exact reversal of `SPENT_ON_RIDE`, and its own type rather than a `CREDIT_GRANT` or an
   * `ADJUSTMENT` because it is neither: nobody granted anything and nobody corrected a mistake.
   * A customer reading their wallet history should see the money leave for a trip and come back
   * when that trip did not happen, as one pair.
   *
   * Written when a booking ends in `NO_DRIVER_FOUND` holding credit it never used.
   */
  'RELEASED_FROM_RIDE',
  /** A debt collected as part of a booking's payment, bringing the balance back toward zero. */
  'DEBT_COLLECTED',
  /** An admin correction, either direction. Requires a note. */
  'ADJUSTMENT',
] as const;

export type WalletEntryType = (typeof WALLET_ENTRY_TYPES)[number];

export const WALLET_ENTRY_LABELS: Record<WalletEntryType, string> = {
  CREDIT_GRANT: 'Credit added',
  CANCELLATION_FEE: 'Cancellation fee',
  FINE: 'Fine',
  SPENT_ON_RIDE: 'Used on a trip',
  RELEASED_FROM_RIDE: 'Returned — trip did not happen',
  DEBT_COLLECTED: 'Outstanding amount paid',
  ADJUSTMENT: 'Adjustment',
};

export interface WalletEntryDto {
  id: string;
  entry_type: WalletEntryType;
  /** Signed. Positive is credit to the customer, negative is owed by them. */
  amount: Money;
  /**
   * The booking this row is about, where there is one — enough to link a statement row to a trip.
   *
   * NO `booking_reference` BESIDE IT. `wallet` sits below `bookings` in the module graph and
   * cannot read a booking to resolve one; the writer puts the human-readable `DZ-…` into `note`
   * instead, which is where a person reading a statement looks anyway.
   */
  booking_id: string | null;
  note: string | null;
  created_at: string;
}

export interface CustomerWalletDto {
  /** Signed: positive is spendable credit, negative is owed. Summed from the entries. */
  balance: Money;
  /**
   * What is spendable right now — `balance` when positive, zero when not.
   *
   * Sent rather than derived on each client so that four apps cannot disagree about whether a
   * negative balance counts as zero credit or as negative credit.
   */
  spendable_credit: Money;
  /** What the customer owes: the balance when negative, as a positive figure. Zero otherwise. */
  amount_owed: Money;
  entries: WalletEntryDto[];
}

/**
 * `POST /admin/customers/:id/wallet` — the only way credit enters a customer's wallet.
 *
 * A SIGNED AMOUNT, one endpoint for both directions, because granting ₹100 and fining ₹100 are
 * the same operation with the same audit requirements and splitting them into two endpoints
 * would mean two places to get the sign wrong.
 */
export interface GrantWalletCreditRequest {
  entry_type: Extract<WalletEntryType, 'CREDIT_GRANT' | 'FINE' | 'ADJUSTMENT'>;
  /** Signed paise. The server rejects a sign that contradicts `entry_type`. */
  amount_paise: number;
  /** Why. Mandatory — an unexplained movement of someone's money is unanswerable later. */
  note: string;
}

// ─── Admin finance surface ──────────────────────────────────────────────────────────────────

/**
 * One customer on the Finance screen — `GET /admin/finance/customer-wallets`.
 *
 * THE SIGN POINTS THE OTHER WAY from `DriverBalanceRowDto`. A customer wallet is written from
 * the CUSTOMER's side, so a positive balance is credit the company owes them; the driver ledger
 * is written from the company's side, where positive means the same thing but negative means the
 * driver is holding our cash. The two are mirror images and a screen showing both must say which
 * it is showing — see `FinanceTransactionDto.direction` for how the merged feed handles it.
 */
export interface CustomerWalletRowDto {
  customer_id: string;
  name: string | null;
  phone: string | null;
  /** Signed, from the CUSTOMER's side: positive means the company owes them. */
  balance: Money;
  /** What they can actually spend on a fare — `balance` when positive, else zero. */
  spendable_credit: Money;
  /** An unpaid cancellation fee carried forward — `|balance|` when negative, else zero. */
  amount_owed: Money;
  last_entry_at: string | null;
  entry_count: number;
}

export interface AdminCustomerWalletsDto {
  rows: CustomerWalletRowDto[];
  /** Across every page of the filter, not the page returned. */
  totals: {
    customers_in_debt: number;
    total_owed_by_customers: Money;
    customers_in_credit: number;
    /** The company's outstanding liability — credit granted and not yet spent. */
    total_credit_outstanding: Money;
    customers: number;
  };
  pagination: { page: number; limit: number; total_items: number; total_pages: number };
}

export const CUSTOMER_WALLET_STATES = ['ALL', 'IN_CREDIT', 'IN_DEBT', 'SETTLED'] as const;
export type CustomerWalletState = (typeof CUSTOMER_WALLET_STATES)[number];

export interface AdminCustomerWalletsQuery {
  search?: string | undefined;
  state?: CustomerWalletState | undefined;
  sort?: 'BALANCE_ASC' | 'BALANCE_DESC' | 'LAST_ACTIVITY_DESC' | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/**
 * The filters `GET /admin/customers/:id/wallet` accepts.
 *
 * ADDED 2026-09-05 to match the driver side. The customer statement was a hardcoded 100 rows
 * with no paging and no filters, which is the opposite shape from the driver ledger for no
 * reason anyone wrote down — and 100 is a cap a busy customer reaches, at which point the screen
 * silently stops showing their older entries.
 */
export interface CustomerWalletQueryParams {
  page?: number | undefined;
  limit?: number | undefined;
  /** Comma-separated `WalletEntryType`s. */
  type?: string | undefined;
  /** `YYYY-MM-DD`, inclusive, IST. */
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * What `GET /admin/customers/:id/wallet` returns — the customer statement with its pager.
 *
 * A SEPARATE TYPE FROM `CustomerWalletDto`, which `GET /me/wallet` still returns unchanged. The
 * customer app renders a wallet screen, not a filtered statement, and widening the shared DTO
 * would have made `summary` and `pagination` fields that app must carry and never reads. This
 * mirrors the driver side, where `AdminDriverWalletDetailsDto` is the one that has the pager.
 */
export interface AdminCustomerWalletDetailsDto extends CustomerWalletDto {
  /** Credited, debited, net and count across EVERY page of the filter, not the page returned. */
  summary: CustomerWalletSummaryDto;
  pagination: { page: number; limit: number; total_items: number; total_pages: number };
}

/**
 * Totals over a filtered statement.
 *
 * Shaped like the ledger's `LedgerSummaryDto` but declared separately rather than imported: the
 * two modules sit at the same tier and must not depend on each other, and a shared type here
 * would be the wire-level version of the import the architecture forbids.
 */
export interface CustomerWalletSummaryDto {
  /** Money that went the customer's way — grants and refunds. A positive magnitude. */
  credited_paise: number;
  /** Money charged to them — fees and fines. A POSITIVE magnitude, not a negative sum. */
  debited_paise: number;
  /** `credited − debited`. Negative means they owe more than they hold. */
  net_paise: number;
  count: number;
}
