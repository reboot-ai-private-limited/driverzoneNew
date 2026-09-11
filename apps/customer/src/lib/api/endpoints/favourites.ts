import type { FavouriteDriversResponse } from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `/customer/favourite-drivers` —
 * apps/api/src/modules/favourites/interface/favourites.routes.ts.
 *
 * ALL THREE ANSWER WITH THE WHOLE LIST, including the two that change it. The heart is on four
 * different screens and each of them decides its filled state from the same list, so replying with
 * the list is what lets one tap update all four from one response instead of a write followed by a
 * read.
 *
 * Scoped by the access token alone: there is no customer id to pass, and therefore no way to read
 * or edit anybody else's.
 */

export function listFavouriteDrivers(): Promise<FavouriteDriversResponse> {
  return request<FavouriteDriversResponse>(`${ROLE_PREFIX}/favourite-drivers`, {
    token: getAccessToken() ?? undefined,
  });
}

/**
 * The server refuses a driver this customer has never completed a trip with, which is why the
 * heart is only ever rendered where there is a finished trip behind it.
 */
export function addFavouriteDriver(driverId: string): Promise<FavouriteDriversResponse> {
  return request<FavouriteDriversResponse>(`${ROLE_PREFIX}/favourite-drivers`, {
    method: 'POST',
    body: { driver_id: driverId },
    token: getAccessToken() ?? undefined,
  });
}

export function removeFavouriteDriver(driverId: string): Promise<FavouriteDriversResponse> {
  return request<FavouriteDriversResponse>(`${ROLE_PREFIX}/favourite-drivers/${driverId}`, {
    method: 'DELETE',
    token: getAccessToken() ?? undefined,
  });
}
