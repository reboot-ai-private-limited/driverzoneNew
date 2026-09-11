import { z } from 'zod';
import { bearerAuth, errorResponse, registry, successResponse } from '@/shared/http/swagger.util.js';
import { MAX_FAVOURITES } from '../domain/favourite.entity.js';
import { addFavouriteSchema } from './favourites.validation.js';

// ─── Response DTOs ──────────────────────────────────────────────────────────────────────────

const FavouriteDriverDto = z.object({
  id: z.string(),
  name: z.string().nullable(),
  photo_url: z.string().nullable(),
  rating: z.number().nullable(),
  rating_count: z.number(),
  added_at: z.string().datetime(),
});

/*
 * `max` rides along with every list so the apps can grey out the heart at the cap without
 * hardcoding a number only the server actually enforces.
 */
const FavouriteDriversResponse = z.object({
  favourites: z.array(FavouriteDriverDto),
  max: z.number().openapi({ example: MAX_FAVOURITES }),
});

const jsonError = { content: { 'application/json': { schema: errorResponse } } };
const badRequest = { description: 'Not a valid driver id', ...jsonError };
const notFound = {
  description: 'No completed trip with that driver, or the driver no longer exists',
  ...jsonError,
};
const conflict = { description: 'Already at the favourites limit', ...jsonError };

const listResponse = {
  description: "The customer's favourite drivers, newest first",
  content: { 'application/json': { schema: successResponse(FavouriteDriversResponse) } },
};

export function registerFavouritesSwaggerPaths(): void {
  registry.registerPath({
    method: 'get',
    path: '/v1/customer/favourite-drivers',
    tags: ['Customer'],
    summary: 'List favourite drivers',
    description:
      'Drivers this customer wants rung first. Booking with `preferFavouriteDrivers` rings them ' +
      'before the ordinary radius search, and falls through to it as soon as they do not answer.',
    security: bearerAuth,
    responses: { 200: listResponse },
  });

  registry.registerPath({
    method: 'post',
    path: '/v1/customer/favourite-drivers',
    tags: ['Customer'],
    summary: 'Add a favourite driver',
    description:
      'Only a driver this customer has COMPLETED a trip with may be added. Adding one already on ' +
      'the list is a no-op rather than an error. Answers with the whole list.',
    security: bearerAuth,
    request: { body: { content: { 'application/json': { schema: addFavouriteSchema } } } },
    responses: { 200: listResponse, 400: badRequest, 404: notFound, 409: conflict },
  });

  registry.registerPath({
    method: 'delete',
    path: '/v1/customer/favourite-drivers/{driverId}',
    tags: ['Customer'],
    summary: 'Remove a favourite driver',
    description: 'Idempotent — removing one that is not there succeeds. Answers with the whole list.',
    security: bearerAuth,
    request: {
      params: z.object({ driverId: z.string().openapi({ description: 'Driver ID' }) }),
    },
    responses: { 200: listResponse, 400: badRequest },
  });
}
