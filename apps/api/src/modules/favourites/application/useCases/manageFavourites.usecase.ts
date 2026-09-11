import type { FavouriteDriverDto } from '@driverzone/contracts';
import { AppError } from '@/shared/errors/AppError.js';
import type { BookingFavouritesContract } from '../../../bookings/bookings.public.js';
import type { DriverCardContract } from '../../../identity/identity.public.js';
import { MAX_FAVOURITES } from '../../domain/favourite.entity.js';
import type { FavouriteRepositoryPort } from '../../domain/favouriteRepository.port.js';

/**
 * APPLICATION — adding, removing and listing a customer's favourite drivers.
 *
 * THE ONE RULE WORTH THE WHOLE MODULE: a customer may only favourite a driver they have actually
 * completed a trip with. Without it this endpoint is an oracle — pass an arbitrary id and it
 * answers whether that driver exists, then hands back their name and their photograph. The proof
 * comes from `bookings`, which is why `favourites` sits above it in the tier list rather than
 * living as an array on the customer document.
 */
export class ManageFavouritesUseCase {
  constructor(
    private readonly favourites: FavouriteRepositoryPort,
    private readonly bookings: BookingFavouritesContract,
    private readonly drivers: DriverCardContract,
  ) {}

  /**
   * The customer's list, resolved to something a screen can render.
   *
   * TWO CALLS, NOT ONE PER ROW: the ids come from this module's own collection and the cards come
   * from `identity` in a single batched lookup, the same way every booking list resolves its
   * driver.
   *
   * A favourite whose driver has since been deleted is DROPPED rather than rendered blank. The
   * alternative is a row with no name and no way to act on it, which a customer can only read as
   * the app being broken.
   */
  async list(customerId: string): Promise<{ favourites: FavouriteDriverDto[]; max: number }> {
    const rows = await this.favourites.listForCustomer(customerId);
    if (rows.length === 0) return { favourites: [], max: MAX_FAVOURITES };

    const cards = await this.drivers.driverCardsByIds(rows.map((row) => row.driverId));

    const favourites = rows.flatMap((row): FavouriteDriverDto[] => {
      const card = cards.get(row.driverId);
      if (card === undefined) return [];

      return [
        {
          id: card.id,
          name: card.fullName,
          photo_url: card.photoUrl,
          rating: card.rating,
          rating_count: card.ratingCount,
          added_at: row.createdAt.toISOString(),
        },
      ];
      /*
       * `card.phone` IS DELIBERATELY NOT COPIED ACROSS. `DriverCardContract` returns it
       * unconditionally and makes the caller responsible for deciding who may see it. A
       * favourites list is not a live trip: there is nobody at a kerb to reach, and that number
       * is the one the driver's own login OTP is sent to.
       */
    });

    return { favourites, max: MAX_FAVOURITES };
  }

  /**
   * Adds one. Idempotent: tapping an already-favourited driver is success, not a conflict.
   *
   * ORDER MATTERS HERE. The shared-trip check runs BEFORE the driver is looked up, so a caller
   * probing ids learns nothing from the difference between a driver who does not exist and one
   * they have simply never ridden with — both answer the same 404.
   */
  async add(customerId: string, driverId: string): Promise<void> {
    const rode = await this.bookings.hasCompletedTripTogether(customerId, driverId);
    if (!rode) {
      throw AppError.notFound('You can only add a driver you have completed a trip with.');
    }

    const card = (await this.drivers.driverCardsByIds([driverId])).get(driverId);
    if (card === undefined) throw AppError.notFound('That driver no longer exists.');

    /*
     * Checked before the insert rather than after, so the cap message names the limit instead of
     * reporting a write that already happened. The race it leaves — two simultaneous adds at
     * exactly the cap — is worth one extra favourite and not worth a transaction.
     */
    if ((await this.favourites.countForCustomer(customerId)) >= MAX_FAVOURITES) {
      throw AppError.conflict(
        `You can have up to ${MAX_FAVOURITES} favourite drivers. Remove one to add another.`,
      );
    }

    await this.favourites.add(customerId, driverId);
  }

  /**
   * Removes one. Idempotent, and deliberately without an existence check: the caller asked for
   * this driver not to be a favourite, and afterwards they are not. A 404 here would only ever
   * fire on a double tap.
   */
  async remove(customerId: string, driverId: string): Promise<void> {
    await this.favourites.remove(customerId, driverId);
  }
}
