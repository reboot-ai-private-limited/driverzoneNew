/**
 * DOMAIN — a customer's standing preference for one driver.
 *
 * There is almost nothing here, and that is honest: a favourite is a pair of ids and a date. The
 * interesting rules are about who may CREATE one, and they live in the use case because they need
 * to ask `bookings` a question this file cannot.
 *
 * WHAT A FAVOURITE IS NOT. It is not a claim on a driver, not a promise about a future trip, and
 * not visible to the driver. Dispatch rings the favourites first and moves on the moment they do
 * not answer — see `runWave.usecase.ts` on wave 0.
 */

export interface FavouriteDriver {
  customerId: string;
  driverId: string;
  /** When the customer added them. The list is newest-first. */
  createdAt: Date;
}

/**
 * How many drivers one customer may favourite.
 *
 * A CAP EXISTS BECAUSE WAVE 0 PAYS FOR IT. Every favourite is an id in a `$in` on the dispatch
 * geospatial query and, when they are in range, a ring on somebody's handset before the ordinary
 * search starts. A customer with two hundred favourites would have turned "ring my drivers first"
 * back into "ring everyone", slowly. Twenty is far more than the handful this feature is for and
 * still small enough that the wave stays a wave.
 */
export const MAX_FAVOURITES = 20;
