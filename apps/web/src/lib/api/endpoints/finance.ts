import type {
  AdminCustomerWalletsDto,
  AdminCustomerWalletsQuery,
  AdminDriverBalancesDto,
  AdminDriverBalancesQuery,
  AdminFinanceTransactionsDto,
  AdminFinanceTransactionsQuery,
  CustomerWalletDto,
  GrantWalletCreditRequest,
  Money,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/finance` — mirrors `apps/api/src/modules/admin/interface/finance.routes.ts`.
 *
 * Served by the API's tier-8 `admin` module, which exists because a finance screen needs data
 * from `ledger` and `wallet`, and those two sit on the same tier and may not read each other.
 *
 * Filtering, sorting and paging are all SERVER-SIDE. These lists are groupings over whole
 * collections, so a client-side filter would only narrow the rows already fetched and would miss
 * every match beyond the current page.
 */

/** What a settlement reports back. Not the refreshed wallet — the caller invalidates that. */
export interface SettlementReceiptDto {
  entry_id: string;
  type: string;
  amount: Money;
  balance_before: Money;
  balance_after: Money;
}

export const financeApi = {
  /**
   * READS TAKE A TRAILING `signal` — the rule `endpoints/customers.ts` and `endpoints/bookings.ts`
   * both state. A read is abandoned the moment its query key changes.
   */
  driverBalances: (token: string, query?: AdminDriverBalancesQuery, signal?: AbortSignal) =>
    request<AdminDriverBalancesDto>('/admin/finance/driver-balances', {
      token,
      signal,
      ...(query === undefined
        ? {}
        : {
            query: {
              search: query.search,
              state: query.state,
              suspended: query.suspended,
              min_owed_paise: query.min_owed_paise,
              sort: query.sort,
              page: query.page,
              limit: query.limit,
            },
          }),
    }),

  /**
   * The movement feed. DRIVER-SIDE ONLY today — the API has no cross-customer wallet FEED (the
   * customer list below is a different query), so there is no `party` parameter rather than one
   * that accepts `CUSTOMER` and silently returns nothing.
   */
  transactions: (token: string, query?: AdminFinanceTransactionsQuery, signal?: AbortSignal) =>
    request<AdminFinanceTransactionsDto>('/admin/finance/transactions', {
      token,
      signal,
      ...(query === undefined
        ? {}
        : {
            query: {
              search: query.search,
              driver_id: query.driver_id,
              type: query.type,
              from: query.from,
              to: query.to,
              page: query.page,
              limit: query.limit,
            },
          }),
    }),

  customerWallets: (token: string, query?: AdminCustomerWalletsQuery, signal?: AbortSignal) =>
    request<AdminCustomerWalletsDto>('/admin/finance/customer-wallets', {
      token,
      signal,
      ...(query === undefined
        ? {}
        : {
            query: {
              search: query.search,
              state: query.state,
              sort: query.sort,
              page: query.page,
              limit: query.limit,
            },
          }),
    }),

  /**
   * Grant credit or apply a fine. WRITES DO NOT TAKE A SIGNAL — a request that has reached the
   * server cannot be un-sent, and aborting one only loses us the answer to something that
   * happened anyway.
   *
   * Not a new endpoint: `POST /admin/customers/:id/wallet` has existed with no consumers.
   */
  grantWalletCredit: (token: string, customerId: string, body: GrantWalletCreditRequest) =>
    request<CustomerWalletDto>(`/admin/customers/${customerId}/wallet`, {
      method: 'POST',
      token,
      body,
    }),

  /**
   * Record a settlement against a driver.
   *
   * `idempotencyKey` is REQUIRED and must be STABLE across retries — the caller generates one per
   * dialog opening, not per click, which is what makes a double-tap clear a balance once. The
   * ledger is append-only, so a duplicate cannot be taken back, only annotated.
   */
  settleDriver: (
    token: string,
    driverId: string,
    body: { amount_paise: number; note: string; reference?: string | undefined },
    idempotencyKey: string,
  ) =>
    request<SettlementReceiptDto>(`/admin/finance/drivers/${driverId}/settle`, {
      method: 'POST',
      token,
      body,
      idempotencyKey,
    }),
};
