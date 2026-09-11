/**
 * PUBLIC CONTRACT — the only surface other modules may import from `favourites`.
 *
 * `dispatch` is the sole consumer, and one method is all it gets. It may ask WHO a customer's
 * favourites are; it may not add one, remove one, or learn when they were added. Adding a
 * favourite requires proof that the two have ridden together, and the module that rings phones is
 * not the place that decision could ever be made correctly.
 */
export interface FavouriteDriversContract {
  /**
   * Newest-first driver ids this customer has favourited. Empty when they have none.
   *
   * IDS, NOT CARDS. Dispatch feeds these straight into the eligibility query and never renders
   * them — handing it names, photos and phone numbers would be handing the ringing path a
   * customer's contact list for no reason.
   */
  favouriteDriverIds(customerId: string): Promise<string[]>;
}

export { MAX_FAVOURITES } from './domain/favourite.entity.js';
