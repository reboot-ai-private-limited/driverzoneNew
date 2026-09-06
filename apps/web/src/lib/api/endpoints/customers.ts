import type {
  AdminCustomerDetailsDto,
  AdminCustomerListDto,
  AdminCustomerWalletDetailsDto,
  AdminUpdateCustomerRequest,
  CustomerWalletQueryParams,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/customers` — mirrors `apps/api/src/modules/identity/interface/admin.routes.ts`.
 *
 * The wire types now live in `@driverzone/contracts` alongside the driver ones, so this file
 * holds only the calls. It carried its own copies while the endpoints did not exist yet — a
 * contract package is meant to be the shared truth about what a server actually produces, not a
 * wish list of what it might one day.
 *
 * Paged SERVER-SIDE, unlike zones. Zones are tens of rows and the whole set crosses the wire at
 * once; customers grow with every signup and every row is PII, so fetching all of them to render
 * ten is the wrong trade on both counts.
 */

/**
 * `search` and `limit`, not `q` and `page_size`: this matches `GET /admin/drivers` exactly, so
 * both admin directories page identically rather than each inventing its own spelling.
 */
export interface ListCustomersQuery {
  /** Matches name, mobile number or number plate. Substring, case-insensitive. */
  search?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
  is_blocked?: boolean | undefined;
}

/**
 * READS TAKE A TRAILING `signal`; WRITES DO NOT — the same rule as `endpoints/zones.ts`. A read
 * is abandoned the moment its query key changes and TanStack supplies the signal for exactly
 * that; a write that has reached the server cannot be un-sent, and aborting one only loses us
 * the answer to something that happened anyway.
 */
export const customersApi = {
  list: (token: string, query?: ListCustomersQuery, signal?: AbortSignal) =>
    request<AdminCustomerListDto>('/admin/customers', {
      token,
      signal,
      ...(query === undefined
        ? {}
        : {
            query: {
              search: query.search,
              page: query.page,
              limit: query.limit,
              is_blocked: query.is_blocked,
            },
          }),
    }),

  get: (token: string, id: string, signal?: AbortSignal) =>
    request<AdminCustomerDetailsDto>(`/admin/customers/${id}`, { token, signal }),

  /**
   * One customer's wallet statement — filtered, paged, with totals over the whole selection.
   *
   * The mirror of `/admin/drivers/:id/wallet`, and deliberately the same query shape. The
   * balance it returns is always the FULL balance, never the sum of the filtered rows: what the
   * customer owes today does not change because someone narrowed the view to March.
   */
  wallet: (token: string, id: string, query?: CustomerWalletQueryParams, signal?: AbortSignal) =>
    request<AdminCustomerWalletDetailsDto>(`/admin/customers/${id}/wallet`, {
      token,
      signal,
      ...(query === undefined
        ? {}
        : {
            query: {
              page: query.page,
              limit: query.limit,
              type: query.type,
              from: query.from,
              to: query.to,
            },
          }),
    }),

  /**
   * No idempotency key: this PATCH is idempotent by construction — the same body applied twice
   * leaves the same record. Keys belong on writes that CREATE, where a replay makes a second row.
   */
  update: (token: string, id: string, body: AdminUpdateCustomerRequest) =>
    request<AdminCustomerDetailsDto>(`/admin/customers/${id}`, { method: 'PATCH', token, body }),
};
