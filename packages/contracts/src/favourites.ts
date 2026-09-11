/**
 * FAVOURITE DRIVERS — the drivers a customer wants rung before anyone else.
 *
 * A favourite is a PREFERENCE, not a booking. Marking someone changes nothing on its own; it is
 * `CreateBookingRequest.preferFavouriteDrivers` that asks dispatch to run a wave over this list
 * first, and that wave falls through to the ordinary radius ladder as soon as those drivers
 * decline, ignore, or turn out not to be eligible.
 *
 * A customer may only favourite a driver they have COMPLETED a trip with. That rule lives on the
 * server (`modules/favourites`), not in the apps: without it, `POST /customer/favourite-drivers`
 * would answer "does this driver id exist, and what is their name and face" to anyone holding a
 * customer token.
 */

/**
 * A favourite, as the customer's own list shows them.
 *
 * DELIBERATELY THE SAME FIELDS AS `BookingDto.driver` MINUS `phone`. A favourites list is not a
 * live trip: there is nobody at a kerb to reach, so there is no justification for handing out the
 * number a driver logs in with. `rating` stays null until somebody has actually rated them —
 * the account row defaults to 5.0, and `rating_count` is what tells an earned average from that.
 */
export interface FavouriteDriverDto {
  id: string;
  name: string | null;
  /** A fetchable URL, not a storage key. Null when the driver has not uploaded one. */
  photo_url: string | null;
  rating: number | null;
  rating_count: number;
  /** ISO 8601 — when the customer added them. The list is newest-first. */
  added_at: string;
}

/** `POST /customer/favourite-drivers`. Adding one already on the list is a no-op, not an error. */
export interface AddFavouriteDriverRequest {
  driver_id: string;
}

/**
 * `GET /customer/favourite-drivers`.
 *
 * `max` rides along so the apps can disable the heart at the cap without hardcoding a number that
 * only the server actually enforces.
 */
export interface FavouriteDriversResponse {
  favourites: FavouriteDriverDto[];
  max: number;
}
