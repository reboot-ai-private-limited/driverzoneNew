import type { Router } from 'express';
import type { BookingFavouritesContract } from '../bookings/bookings.public.js';
import type { DriverCardContract } from '../identity/identity.public.js';
import type { FavouriteDriversContract } from './favourites.public.js';
import { MongoFavouriteRepository } from './infrastructure/favouriteRepository.impl.js';
import { ManageFavouritesUseCase } from './application/useCases/manageFavourites.usecase.js';
import { makeFavouritesControllers } from './interface/favourites.controller.js';
import { buildFavouritesRouter } from './interface/favourites.routes.js';
import { registerFavouritesSwaggerPaths } from './interface/favourites.swagger.js';

export interface FavouritesDependencies {
  /**
   * One boolean: have this customer and this driver finished a trip together? That is the whole
   * reason this module sits above `bookings` instead of being an array on the customer document.
   */
  bookings: BookingFavouritesContract;
  /** Names, photos and ratings for the list. Batched — never a lookup per row. */
  identity: DriverCardContract;
}

export interface FavouritesContainer {
  /** What `dispatch` gets: the ids, and nothing else. */
  contract: FavouriteDriversContract;
  buildCustomerRouter: () => Router;
}

export function buildFavouritesContainer(deps: FavouritesDependencies): FavouritesContainer {
  registerFavouritesSwaggerPaths();

  const repo = new MongoFavouriteRepository();
  const manage = new ManageFavouritesUseCase(repo, deps.bookings, deps.identity);

  return {
    contract: {
      favouriteDriverIds: async (customerId) =>
        (await repo.listForCustomer(customerId)).map((row) => row.driverId),
    },

    buildCustomerRouter: () => buildFavouritesRouter(makeFavouritesControllers(manage)),
  };
}
