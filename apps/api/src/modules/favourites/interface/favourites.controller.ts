import type { Request, RequestHandler } from 'express';
import { AppError } from '@/shared/errors/AppError.js';
import { asyncHandler } from '@/shared/http/asyncHandler.js';
import { sendSuccess } from '@/shared/http/response.util.js';
import type { ManageFavouritesUseCase } from '../application/useCases/manageFavourites.usecase.js';
import { addFavouriteSchema, driverIdParamSchema } from './favourites.validation.js';

/**
 * INTERFACE — HTTP in, HTTP out. Every rule about who may favourite whom is a layer down.
 *
 * NOTE WHAT NONE OF THESE READ FROM THE REQUEST: the customer. It comes from the token, so no
 * caller can edit somebody else's favourites by sending a different id.
 */

/**
 * The authenticated subject's id. Throws rather than returning undefined: no principal means the
 * route was mounted without `requireAuth`, a wiring bug that must fail loudly rather than fall
 * through to acting on nobody.
 */
function subjectId(req: Request): string {
  const id = req.principal?.sub;
  if (id === undefined) throw AppError.unauthenticated();
  return id;
}

export interface FavouritesControllers {
  list: RequestHandler;
  add: RequestHandler;
  remove: RequestHandler;
}

export function makeFavouritesControllers(useCase: ManageFavouritesUseCase): FavouritesControllers {
  return {
    list: asyncHandler(async (req, res) => {
      sendSuccess(req, res, await useCase.list(subjectId(req)));
    }),

    add: asyncHandler(async (req, res) => {
      const { driver_id: driverId } = addFavouriteSchema.parse(req.body);

      await useCase.add(subjectId(req), driverId);

      /*
       * The whole list back, not the one row. The heart is on four different screens and each of
       * them holds the list; answering with the list is what lets a client refresh all of them
       * from one response instead of re-reading after every tap.
       */
      sendSuccess(req, res, await useCase.list(subjectId(req)), 'Added to your favourite drivers');
    }),

    remove: asyncHandler(async (req, res) => {
      const { driverId } = driverIdParamSchema.parse(req.params);

      await useCase.remove(subjectId(req), driverId);

      sendSuccess(
        req,
        res,
        await useCase.list(subjectId(req)),
        'Removed from your favourite drivers',
      );
    }),
  };
}
