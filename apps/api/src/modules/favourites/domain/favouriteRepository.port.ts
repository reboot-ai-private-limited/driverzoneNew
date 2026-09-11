import type { FavouriteDriver } from './favourite.entity.js';

export interface FavouriteRepositoryPort {
  /**
   * Adds one, or does nothing if it is already there.
   *
   * IDEMPOTENT BY DESIGN, and it returns whether the row is new. Two taps on a heart, or a retry
   * of the first, must not be an error the app has to explain — but the caller still needs to know
   * whether the cap was consumed.
   */
  add(customerId: string, driverId: string): Promise<{ added: boolean }>;

  /** Idempotent too. Removing one that is not there is the state the caller asked for. */
  remove(customerId: string, driverId: string): Promise<void>;

  /** Newest-first. The customer's own list, and what dispatch's wave 0 rings. */
  listForCustomer(customerId: string): Promise<FavouriteDriver[]>;

  /** How many this customer has, for the cap. A count, not a list — the rows are not needed. */
  countForCustomer(customerId: string): Promise<number>;
}
