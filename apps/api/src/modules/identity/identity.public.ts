import type { Role } from '@driverzone/contracts';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `identity`.
 *
 * Types only, so this file compiles to no JavaScript at all. See
 * docs/engineering/module-anatomy.md for why that costs nothing at runtime.
 *
 * Note what is deliberately **not** here: anything for verifying a bearer token. That lives in
 * `shared/security/jwt.ts` and `shared/http/auth.middleware.ts`, because every module eventually
 * needs to check a token and none of them should have to depend on `identity` to do it.
 * `identity` owns *issuing* tokens — it holds the session store — and verification is a
 * stateless function anything may call.
 */

/** Re-exported so consumers get the account slice without importing the wire package directly. */
export interface IdentityAccount {
  id: string;
  mobileNumber: string;
  fullName: string | null;
}

/**
 * Read-side lookups for modules that need to name a person.
 *
 * Batched on purpose. A per-id method called inside a `.map()` is one query per row, and the
 * admin panel's booking list renders a customer name on every line — see the "batch, don't
 * invite N+1" rule in docs/engineering/module-anatomy.md.
 *
 * `reviews` is the first consumer: the admin review ledger renders a reviewer and a reviewee name
 * on every row, and both come out of one call per role rather than two lookups per row.
 */
export interface AccountDirectoryContract {
  namesByIds(role: Role, ids: string[]): Promise<Map<string, string | null>>;
}

/**
 * Write-side, for `bookings` only.
 *
 * Split from the read contract per Interface Segregation: a module that only needs to display a
 * name must not be handed methods that mutate a customer's saved addresses.
 *
 * Called when `POST /bookings` carries `save_pickup_address` or `save_vehicle` — the mechanism
 * behind customer progressive profile completion (docs/LLD/user.md §Module contract).
 *
 * **Both are upserts keyed on the real-world identity of the thing** — coordinates for an
 * address, number plate for a vehicle — and both return the id of the existing entry when one
 * matches. A customer booking twice from home ends with one saved address, and neither method
 * ever fails on a duplicate: a booking must not be lost because its optional side effect had
 * nothing new to do.
 */
export interface CustomerBookingProfileContract {
  upsertVehicleFromBooking(
    customerId: string,
    vehicle: { category: string; plateNumber: string; fuelType?: string | undefined },
  ): Promise<string>;

  upsertAddressFromBooking(
    customerId: string,
    address: {
      label: 'HOME' | 'OFFICE' | 'OTHER';
      address: string;
      lat: number;
      lng: number;
      isPreferredPickup?: boolean | undefined;
    },
  ): Promise<string>;
}

/**
 * The cached rolling average on a customer or driver document.
 *
 * `reviews` owns the arithmetic and the `reviews` collection; identity owns the account row. So
 * this takes an ALREADY-COMPUTED figure and stores it — it does not read reviews, and could not,
 * since `reviews` sits above it. Dispatch and the apps read `rating` off the account rather than
 * aggregating a collection, which is the whole reason the cache exists (docs/LLD/reviews.md).
 */
export interface RatingCacheContract {
  setRating(role: Role, id: string, average: number, count: number): Promise<void>;
}

/**
 * The whole surface, as returned by `buildIdentityContainer()`.
 *
 * Authentication is deliberately absent: it is consumed over HTTP and through the shared JWT
 * verifier rather than through a module contract, so nothing here issues or checks a token.
 */
export type IdentityPublicContract = CustomerBookingProfileContract &
  AccountDirectoryContract &
  RatingCacheContract;
