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

  /**
   * The ids of accounts whose name or mobile number matches `search`, for a caller that filters
   * its OWN rows by them.
   *
   * IT RETURNS IDS, NOT ROWS, and that is the whole design. The admin booking list must find "every
   * booking by Rahul", but `bookings` cannot read the accounts collection and has no business
   * learning what a phone number looks like. So identity answers the only question it is
   * competent to answer — which accounts are these words about — and the caller intersects that
   * with its own table. The alternative is a join across a module boundary, or `bookings`
   * reimplementing name search over a collection it does not own.
   *
   * `limit` is not optional politeness: a one-letter search matches most of the customer table,
   * and an unbounded answer would be spliced into an `$in` with fifty thousand ids in it. A
   * caller that hits the cap gets the first `limit` matches, which for a search box is what the
   * person wanted anyway — they narrow the term rather than page through the ambiguity.
   */
  idsMatching(role: Role, search: string, limit: number): Promise<string[]>;
}

/**
 * A driver as a CUSTOMER sees them: the card on the trip screen.
 *
 * Separate from `namesByIds` rather than an expansion of it, per Interface Segregation — the
 * admin review ledger wants a name and has no business being handed a phone number. It is also
 * why this contract exists at all instead of `bookings` reading the driver collection: the phone
 * number is the driver's login credential, and exactly one module should decide who may see it.
 *
 * `phone` is returned here unconditionally. WHEN it reaches a customer is the caller's decision
 * and `bookings` makes it — the trip must be live — because only that module knows what a booking
 * is doing. This contract's job is to answer "who is this driver", not to police the trip.
 */
export interface DriverCard {
  id: string;
  fullName: string | null;
  /** The driver's real number. See the note above on who is allowed to pass it on. */
  phone: string | null;
  /** A fetchable URL, already resolved from the storage key — never the key itself. */
  photoUrl: string | null;
  /** Null until `ratingCount` is above zero: the account row defaults to 5.0 unrated. */
  rating: number | null;
  ratingCount: number;
}

export interface DriverCardContract {
  /** Batched, like `namesByIds` — a list of bookings must not be a query per row. */
  driverCardsByIds(ids: string[]): Promise<Map<string, DriverCard>>;
}

/**
 * A customer as the DRIVER on their trip sees them: name, and the number to call at the kerb.
 *
 * The mirror of `DriverCard`, and separate from `namesByIds` for the same Interface Segregation
 * reason — the admin ledger and the driver's ride history want a name and have no business being
 * handed a phone number. `phone` is returned here unconditionally; WHEN it reaches the driver is
 * `bookings`' decision (the trip must be live), because only that module knows what a booking is
 * doing.
 */
export interface CustomerContact {
  id: string;
  fullName: string | null;
  /** The customer's real number. See the note above on who is allowed to pass it on. */
  phone: string | null;
}

export interface CustomerContactContract {
  /** Batched, like `driverCardsByIds` — a list of trips must not be a query per row. */
  customerContactsByIds(ids: string[]): Promise<Map<string, CustomerContact>>;
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
  DriverCardContract &
  CustomerContactContract &
  RatingCacheContract;
