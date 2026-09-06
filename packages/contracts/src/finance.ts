import type { Money } from './http.js';

/**
 * Finance and wallet wire types.
 *
 * Money is ALWAYS represented as integer paise.
 *
 * The older driver-ledger types below carry raw `*_paise` numbers and are left that way — the
 * driver app consumes them. Everything under "Admin finance surface" uses `Money`, which pairs
 * the paise with a preformatted string so four clients cannot each invent their own rupee.
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
  /**
   * Cash a driver handed BACK to the company, clearing what they owed. Positive.
   *
   * THE MIRROR OF `PAYOUT`, and added because that one only ever pointed one way. `PAYOUT` is
   * documented as "paid out TO the driver" and is negative, which covers a driver the company
   * owes — but the common case in a cash business is the opposite: a driver holding fares they
   * collected, whose balance is negative and who eventually settles up. Before this there was no
   * type for that, so it would have gone in as an `ADJUSTMENT` — a type that means "a manual
   * correction by an admin" and would have made cash receipts and error corrections
   * indistinguishable forever, in a ledger that cannot be edited.
   *
   * Named to match the customer wallet's `DEBT_COLLECTED`, which already meant exactly this on
   * the other side of the business.
   */
  'DEBT_COLLECTED',
  /** A manual correction by an admin. Either sign, always with a reason. */
  'ADJUSTMENT',
  /** A late fine or a cancellation penalty. Negative. */
  'PENALTY',
  /** An incentive. Positive. */
  'BONUS',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

/**
 * What each type is called on a screen, mirroring `WALLET_ENTRY_LABELS` on the customer side.
 *
 * Here rather than in each client because there were already two copies drifting: a
 * hand-written map inside the admin panel's driver wallet tab, and `FALLBACK_DESCRIPTION` in the
 * API's `ledger.mapper.ts`. A label is part of what this enum MEANS — a reader who sees
 * `COMMISSION_DEBIT` and a reader who sees "Commission" must be looking at the same row.
 */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  TRIP_EARNING: 'Trip earning',
  WAITING_EARNING: 'Waiting time',
  COMMISSION_DEBIT: 'Commission',
  CASH_COLLECTED: 'Cash collected',
  PAYOUT: 'Payout',
  DEBT_COLLECTED: 'Debt collected',
  ADJUSTMENT: 'Adjustment',
  PENALTY: 'Penalty',
  BONUS: 'Bonus',
};

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

// ─── Admin finance surface ──────────────────────────────────────────────────────────────────

/**
 * One driver on the collections screen — `GET /admin/finance/driver-balances`.
 *
 * COMPUTED FROM THE LEDGER, never from `drivers.walletBalancePaise`. That column is a cache with
 * no writer (verified 2026-09-05: one read in dispatch, a schema default of 0, and nothing that
 * sets it), so reading it here would put a permanent zero next to a driver who owes ₹1,164 —
 * and this is the screen someone settles real cash against.
 *
 * `owed_to_company` and `payable_to_driver` are the same number as `balance`, split by sign and
 * sent as magnitudes. Derived server-side on purpose: an admin table, a CSV export and a printed
 * report would otherwise each decide independently which way a minus sign points.
 */
export interface DriverBalanceRowDto {
  driver_id: string;
  name: string | null;
  /** Ops rings drivers to collect cash. The admin driver directory already shows numbers. */
  phone: string | null;
  /** Signed, from the COMPANY's side: negative means this driver owes us. */
  balance: Money;
  /** `|balance|` when negative, else zero. */
  owed_to_company: Money;
  /** `balance` when positive, else zero. */
  payable_to_driver: Money;
  lifetime_earnings: Money;
  /** Past `driver.max_negative_balance`. Computed with the same setting dispatch reads. */
  is_suspended_for_balance: boolean;
  last_entry_at: string | null;
  entry_count: number;
}

/**
 * Totals across EVERY page of the current filter, not the page returned — the same contract
 * `LedgerSummaryDto` carries and for the same reason.
 */
export interface DriverBalanceTotalsDto {
  drivers_in_debt: number;
  total_owed_to_company: Money;
  drivers_in_credit: number;
  total_payable_to_drivers: Money;
  suspended_count: number;
  /** Drivers matching the filter — equal to `pagination.total_items`. */
  drivers: number;
}

export interface AdminDriverBalancesDto {
  rows: DriverBalanceRowDto[];
  totals: DriverBalanceTotalsDto;
  pagination: { page: number; limit: number; total_items: number; total_pages: number };
}

/** Which side of the business a balance sits on. */
export const DRIVER_BALANCE_STATES = [
  'ALL',
  'OWED_TO_COMPANY',
  'OWED_TO_DRIVER',
  'SETTLED',
] as const;
export type DriverBalanceState = (typeof DRIVER_BALANCE_STATES)[number];

export const DRIVER_BALANCE_SORTS = ['BALANCE_ASC', 'BALANCE_DESC', 'LAST_ACTIVITY_DESC'] as const;
export type DriverBalanceSort = (typeof DRIVER_BALANCE_SORTS)[number];

/**
 * `GET /admin/finance/driver-balances`.
 *
 * NO DATE RANGE, deliberately. A balance is all-time — "what does this driver owe" has no
 * meaningful `from`, and offering one would produce a number nobody could settle against.
 * Date filtering belongs on the transactions feed, which is about movements rather than state.
 */
export interface AdminDriverBalancesQuery {
  /** Matches a driver's name or mobile number, resolved through the identity directory. */
  search?: string | undefined;
  state?: DriverBalanceState | undefined;
  /** Only drivers past the negative-balance threshold. */
  suspended?: boolean | undefined;
  /** Collections triage — "everyone over ₹1,000". Applies to the owed magnitude. */
  min_owed_paise?: number | undefined;
  /** Defaults to `BALANCE_ASC`: deepest debt first, which is the working order. */
  sort?: DriverBalanceSort | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/** Whose ledger a row came from. The two have opposite sign conventions — see `direction`. */
export type FinancePartyKind = 'DRIVER' | 'CUSTOMER';

export const FINANCE_PARTY_FILTERS = ['ALL', 'DRIVER', 'CUSTOMER'] as const;
export type FinancePartyFilter = (typeof FINANCE_PARTY_FILTERS)[number];

/**
 * One row of the unified transactions feed — `GET /admin/finance/transactions`.
 *
 * NOT `LedgerEntryDto`. That type carries `driver_id` and `balance_after_paise`, and neither
 * survives the move to a mixed feed: a customer row has no driver, and a running balance across
 * two different accounts is a number that means nothing.
 */
export interface FinanceTransactionDto {
  id: string;
  party: { kind: FinancePartyKind; id: string; name: string | null };
  /** A `TransactionType` when `party.kind` is DRIVER, a `WalletEntryType` when CUSTOMER. */
  type: string;
  /** Resolved server-side from the matching label map, so one table can render both ledgers. */
  type_label: string;
  /** Signed AS STORED, in that party's own convention. Read `direction` before this. */
  amount: Money;
  /**
   * WHICH WAY THE MONEY MOVED, normalised across both ledgers.
   *
   * The load-bearing field of this whole DTO. The driver ledger is written from the company's
   * side (a negative row means the driver owes us) and the customer wallet from the customer's
   * (a negative row means they owe us). So two −₹500 rows can mean opposite things, and a table
   * that showed only `amount` would state the opposite of the truth for one of them. `IN` is
   * money toward the company, `OUT` is away from it.
   */
  direction: 'IN' | 'OUT' | 'NEUTRAL';
  booking_id: string | null;
  note: string | null;
  created_at: string;
}

export interface AdminFinanceTransactionsDto {
  entries: FinanceTransactionDto[];
  /** Over the whole selection, every page of it — same contract as `LedgerSummaryDto`. */
  summary: LedgerSummaryDto;
  pagination: { page: number; limit: number; total_items: number; total_pages: number };
}

export interface AdminFinanceTransactionsQuery {
  /** Defaults to `DRIVER`, which keeps day-to-day settlement work off the merged path. */
  party?: FinancePartyFilter | undefined;
  driver_id?: string | undefined;
  customer_id?: string | undefined;
  search?: string | undefined;
  /** Comma-separated, validated against the enum belonging to `party`. A typo is a 400. */
  type?: string | undefined;
  /** `YYYY-MM-DD`, inclusive, IST — identical semantics to `LedgerQueryParams`. */
  from?: string | undefined;
  to?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

/**
 * `POST /admin/finance/drivers/:id/settle` — recording that a balance was cleared.
 *
 * ONE ROW, APPENDED. There is no edit and no delete: the ledger is append-only, so a settlement
 * entered by mistake can only be annotated with an `ADJUSTMENT`, never removed. The endpoint
 * therefore refuses more than it accepts — see the notes on each field.
 *
 * THE DIRECTION IS NOT SENT. The server reads the driver's current balance and decides: a
 * negative balance means the driver is repaying the company, a positive one means the company is
 * paying the driver. A client that could choose would eventually choose wrong, and the wrong
 * choice is a row that says money moved the way it did not.
 */
export interface SettleDriverRequest {
  /**
   * A POSITIVE magnitude, never signed — the sign is the server's to decide.
   *
   * Capped at the outstanding balance, recomputed server-side at the moment of the write. The
   * client's figure is a suggestion; settling more than is owed is a 400, not a credit.
   */
  amount_paise: number;
  /** Mandatory. A money row with no stated reason is one nobody can audit later. */
  note: string;
  /** A UTR, receipt number or similar. Free text, optional. */
  reference?: string | undefined;
}
