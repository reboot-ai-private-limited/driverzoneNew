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
   * `SUM()`, which the LLD is explicit must never happen.
   *
   * It is a cumulative sum over the driver's WHOLE statement, computed in the same query that
   * reads the page — not a walk back from the current balance, which is what it used to be. That
   * changed when the statement gained filters (2026-09-04): a walk-back assumes the page holds
   * consecutive rows, so under a filter it would skip everything the filter excluded and quietly
   * report balances that never existed. This number is the real balance after this row whether or
   * not a filter is on.
   */
  balance_after_paise: number;
  /** Optional reference to the entity that caused this (e.g., Booking ID or Payout Batch ID) */
  reference_id: string | null;
  /** Human-readable description (e.g., "Trip earnings for DZ-8F3K2M") */
  description: string;
  created_at: string;
}

/**
 * A driver's wallet with a page of the rows behind it.
 *
 * ONE SHAPE, TWO READERS — the admin looking at a driver (`GET /admin/drivers/:id/wallet`) and
 * the driver looking at themselves (`GET /driver/wallet`). They are the same question asked from
 * two sides, so they share a mapper on the server and a type here; two shapes would be two
 * running-balance derivations to keep in agreement, and a driver whose app disagrees with the
 * admin screen about what they are owed is the exact argument neither side can win.
 */
export interface WalletDetailsDto {
  wallet: WalletBalanceDto;
  ledger: LedgerEntryDto[];
  /** What the current filter selects, across every page of it — see `LedgerSummaryDto`. */
  summary: LedgerSummaryDto;
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

/**
 * The totals for the rows a statement query SELECTS — every page of them, not the page returned.
 *
 * This is what makes a filter worth having. "Trip earnings, this month" is a question about a
 * number, and a driver who has to add up three pages of rows to answer it has been given a list
 * rather than an answer. Unfiltered, it describes the whole statement.
 *
 * `credited` and `debited` are kept apart rather than netted because they answer different
 * questions — what came in, what went out — and `net` is the one figure that would otherwise be
 * derived twice, differently, on two clients.
 */
export interface LedgerSummaryDto {
  /** Sum of the POSITIVE matching rows. Always ≥ 0. */
  credited_paise: number;
  /** Sum of the NEGATIVE matching rows, as a POSITIVE magnitude. Always ≥ 0. */
  debited_paise: number;
  /** `credited − debited`. Signed. */
  net_paise: number;
  /** How many rows matched, which is also `pagination.total_items`. */
  count: number;
}

/**
 * The filters `GET /driver/wallet` and `GET /admin/drivers/:id/wallet` accept, as query params.
 *
 * SERVER-SIDE, and that is the point rather than a detail. The statement is paginated, so a
 * filter applied in the client would only ever search the pages already loaded and would silently
 * miss matches on page two — the same trap `apps/customer`'s ride history documents avoiding by
 * not paginating at all. Here the rows genuinely do page, so the filter has to run where they do.
 *
 * Every field is optional; omitting all of them returns the whole statement, exactly as before.
 */
export interface LedgerQueryParams {
  page?: number | undefined;
  limit?: number | undefined;
  /** Comma-separated `TransactionType`s on the wire: `?type=TRIP_EARNING,BONUS`. */
  type?: string | undefined;
  /** `YYYY-MM-DD`, inclusive, in IST — the day the driver means when they say "from the 1st". */
  from?: string | undefined;
  /** `YYYY-MM-DD`, INCLUSIVE of the whole day named. */
  to?: string | undefined;
}

export type AdminDriverWalletDetailsDto = WalletDetailsDto;

/**
 * `GET /driver/wallet` — the driver's own earnings screen.
 *
 * Identical to what an admin sees for this driver, deliberately. A driver is entitled to the
 * ledger that decides their payout, and showing them a reduced version invites the belief that
 * something is being kept from them.
 */
export type DriverWalletDetailsDto = WalletDetailsDto;
