import { request } from '../client';

/**
 * `/admin/customers` — the customer directory.
 *
 * THESE TYPES LIVE HERE RATHER THAN IN `@driverzone/contracts`, and that is temporary.
 *
 * The routes below are NOT implemented in `apps/api` yet — identity's admin surface currently
 * ends at the admin's own profile and the driver verification actions
 * (`apps/api/src/modules/identity/interface/admin.routes.ts`). Until they exist there is nothing
 * for the shared package to be the single source of truth ABOUT: putting a wire type there that
 * no server produces would make the contract package a wish list rather than a contract.
 *
 * When the endpoints land, these types move to `packages/contracts/src/identity.ts` unchanged
 * and this file keeps only the calls — the shape every other endpoint module has. Until then the
 * screen renders its error state, which is the honest thing for it to do.
 */

/**
 * One row of the list.
 *
 * A FLATTENED view, not a `CustomerProfileDto`: the table shows one car and one place per
 * customer, so sending every saved address and vehicle to render two cells would put kilobytes
 * of PII per row on the wire that nothing draws.
 *
 * There is no serial number here. "Sl" is a row's position in the admin's current view — it
 * changes with the sort and the page — so it is computed where that view exists, in the browser.
 */
export interface AdminCustomerListItemDto {
  id: string;
  /** Null until they fill it in: an account starts as a phone number and nothing else. */
  full_name: string | null;
  mobile_number: string;
  /** ISO timestamp of account creation. Rendered IST, like every timestamp in the panel. */
  joined_at: string;
  /** The default vehicle's plate, or the first if none is marked default. */
  car_number: string | null;
  /** Vehicles beyond `car_number`, so the cell can say "+2". */
  other_vehicle_count: number;
  /** Preferred-pickup address, falling back to the default. Free text, as the customer saved it. */
  location: string | null;
  /**
   * Null until the bookings module exists (tier 6, docs/LLD/roadmap.md). The column is built
   * against the field now so that when bookings land, only the server changes.
   */
  last_ride_at: string | null;
  /** Average out of 5. Null until ratings exist — same reasoning as `last_ride_at`. */
  rating: number | null;
  is_blocked: boolean;
}

export type AdminCustomerSort = 'name' | 'joined' | 'mobile';

/**
 * Paged and searched SERVER-SIDE, unlike zones.
 *
 * Zones are tens of rows and the whole set crosses the wire at once (see `endpoints/zones.ts`);
 * customers are unbounded and every row is PII. Fetching all of them so the browser can filter
 * to fifteen is the wrong trade on both counts, and gets worse every week.
 */
export interface ListCustomersQuery {
  /** Matches name, mobile number or plate. Substring, case-insensitive. */
  q?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
  sort?: AdminCustomerSort | undefined;
  dir?: 'asc' | 'desc' | undefined;
  is_blocked?: boolean | undefined;
}

export interface ListCustomersResponse {
  customers: AdminCustomerListItemDto[];
  /** Rows MATCHING the filter, not rows returned — the page count is derived from it. */
  total: number;
  page: number;
  page_size: number;
}

export interface CustomerAddressDto {
  id: string;
  label: 'HOME' | 'OFFICE' | 'OTHER';
  address: string;
  lat: number;
  lng: number;
  is_default: boolean;
  is_preferred_pickup: boolean;
}

export interface CustomerVehicleDto {
  id: string;
  category: string;
  plate_number: string;
  fuel_type: 'PETROL' | 'DIESEL' | 'EV' | 'CNG' | null;
  is_default: boolean;
}

export type CustomerGender = 'MALE' | 'FEMALE' | 'OTHER' | 'PREFER_NOT_TO_SAY';

/** The full record behind the View action: the customer's profile plus what only an admin sees. */
export interface AdminCustomerDetailDto {
  id: string;
  mobile_number: string;
  full_name: string | null;
  /** `YYYY-MM-DD`, not a timestamp — a birthday has no time of day. */
  dob: string | null;
  gender: CustomerGender | null;
  languages_known: string[];
  alternate_number: string | null;
  emergency_contact: { name: string; number: string } | null;
  saved_addresses: CustomerAddressDto[];
  vehicles: CustomerVehicleDto[];
  joined_at: string;
  is_blocked: boolean;
  last_ride_at: string | null;
  rating: number | null;
}

/**
 * What an admin may change on someone else's account — deliberately narrower than the profile
 * the customer edits in their own app (`PATCH /customer/profile`).
 *
 * Addresses and vehicles are absent: those are the customer's own records, and an admin quietly
 * rewriting where somebody lives is a change neither side can see happening. `is_blocked` is the
 * reverse — it belongs only here, since nobody blocks themselves.
 *
 * PATCH semantics, as everywhere: an omitted key leaves the field alone, an explicit `null`
 * clears it. The mobile number is absent because it IS the account — changing it is a different
 * operation with a different audit story, not a form field.
 */
export interface AdminUpdateCustomerRequest {
  full_name?: string | undefined;
  dob?: string | null | undefined;
  gender?: CustomerGender | null | undefined;
  alternate_number?: string | null | undefined;
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
    request<ListCustomersResponse>('/admin/customers', {
      token,
      signal,
      ...(query === undefined
        ? {}
        : {
            query: {
              q: query.q,
              page: query.page,
              page_size: query.page_size,
              sort: query.sort,
              dir: query.dir,
              is_blocked: query.is_blocked,
            },
          }),
    }),

  get: (token: string, id: string, signal?: AbortSignal) =>
    request<AdminCustomerDetailDto>(`/admin/customers/${id}`, { token, signal }),

  /**
   * No idempotency key: `PATCH` here is idempotent by construction — the same body applied twice
   * leaves the same record. Keys belong on writes that CREATE, where a replay makes a second row.
   */
  update: (token: string, id: string, body: AdminUpdateCustomerRequest) =>
    request<AdminCustomerDetailDto>(`/admin/customers/${id}`, { method: 'PATCH', token, body }),
};
