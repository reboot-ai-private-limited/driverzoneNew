import type { NewWalletEntry, WalletEntry, WalletEntryType } from './walletEntry.entity.js';

/** Which rows a statement read selects. Every field absent means the whole statement. */
export interface WalletQuery {
  types?: readonly WalletEntryType[] | undefined;
  from?: Date | undefined;
  /** EXCLUSIVE, like the ledger's — the controller turns an inclusive day into the next midnight. */
  to?: Date | undefined;
}

/** Totals for every row a query selects, not just the page returned. */
export interface WalletTotals {
  creditedPaise: number;
  /** A positive magnitude, not a negative sum. */
  debitedPaise: number;
  count: number;
}

/** Where a customer's balance sits. Positive means the company owes THEM — the mirror of a driver. */
export type CustomerWalletState = 'ALL' | 'IN_CREDIT' | 'IN_DEBT' | 'SETTLED';

export type CustomerWalletSort = 'BALANCE_ASC' | 'BALANCE_DESC' | 'LAST_ACTIVITY_DESC';

export interface CustomerWalletQuery {
  /** `undefined` is 'every customer'; `[]` is 'a search that matched nobody'. Not the same. */
  customerIds?: readonly string[] | undefined;
  state?: CustomerWalletState | undefined;
  sort?: CustomerWalletSort | undefined;
}

export interface CustomerWalletRow {
  customerId: string;
  balancePaise: number;
  entryCount: number;
  lastEntryAt: Date;
}

export interface CustomerWalletAggregate {
  customersInDebt: number;
  totalOwedByCustomersPaise: number;
  customersInCredit: number;
  /** The company's outstanding liability — credit granted and not yet spent. */
  totalCreditOutstandingPaise: number;
  customers: number;
}

/**
 * DOMAIN — what the customer wallet needs from storage, described without naming Mongo.
 *
 * There is no `update` and no `delete`, and that is the design rather than an omission: the port
 * cannot express a mutation, so no use case can offer one. Fixing a wrong row means appending an
 * `ADJUSTMENT`, which leaves the mistake and the correction both readable.
 */
export interface WalletRepositoryPort {
  /**
   * Inserts entries, skipping any that would duplicate a once-per-booking type.
   *
   * Returns only the rows actually written, so a retried booking side effect returns `[]` rather
   * than failing — the caller learns "already done" instead of having to tell a replay apart from
   * a real conflict.
   */
  append(entries: readonly NewWalletEntry[]): Promise<WalletEntry[]>;

  /** The authoritative balance: the sum of every row for this customer. */
  sumForCustomer(customerId: string): Promise<number>;

  listForCustomer(customerId: string, limit: number): Promise<WalletEntry[]>;

  /**
   * One page of a customer's statement, newest first, plus the total for the pager.
   *
   * ADDED 2026-09-05. Before this the statement was `listForCustomer` with a hardcoded cap of 100
   * and no filters — the opposite shape from the driver ledger for no reason anyone wrote down,
   * and a cap a busy customer reaches, at which point their older rows silently stop existing.
   *
   * NO RUNNING BALANCE, unlike the ledger's `pageForDriver`. The customer wallet DTO has never
   * carried one, and adding it here would mean a window function for a column nothing renders.
   */
  pageForCustomer(
    customerId: string,
    page: number,
    limit: number,
    query?: WalletQuery | undefined,
  ): Promise<{ entries: WalletEntry[]; totalItems: number }>;

  /** Credited, debited and count for everything `query` selects — every page of it. */
  totalsForCustomer(customerId: string, query?: WalletQuery | undefined): Promise<WalletTotals>;

  /**
   * One page of customers by balance — the finance screen's customer tab.
   *
   * Computed from the rows. `customers.walletBalancePaise` is a cache with the same problem the
   * driver one has: documented as 'never the truth', and nothing writes it.
   *
   * A customer with no wallet rows does not appear. Correct for a screen about who holds credit
   * or owes a fee, but it means this is not a customer roster.
   */
  pageCustomerWallets(
    query: CustomerWalletQuery,
    page: number,
    limit: number,
  ): Promise<{ rows: CustomerWalletRow[]; totals: CustomerWalletAggregate; totalItems: number }>;

  listForBooking(bookingId: string): Promise<WalletEntry[]>;
}
