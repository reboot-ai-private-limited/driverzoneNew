import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FavouriteDriversResponse } from '@driverzone/contracts';
import {
  addFavouriteDriver,
  listFavouriteDrivers,
  removeFavouriteDriver,
} from '@/lib/api/endpoints/favourites';
import { keys } from '@/lib/query/keys';

/**
 * The customer's favourite drivers, and the one way to change the list.
 *
 * ONE HOOK, FOUR SCREENS. The heart appears on the rating screen, the live trip card, a past ride
 * and the manage page, and all four read this. A tap on any of them fills the heart on the others
 * because they share `keys.favourites.all()` — which is also why the mutation writes the server's
 * reply straight into the cache instead of invalidating and re-fetching.
 *
 * `isFavourite` IS DERIVED HERE RATHER THAN SENT BY THE SERVER. `BookingDto` deliberately carries
 * no `is_favourite`: `bookings` sits below `favourites` in the API's tier list and must not read
 * it. The list is already in memory, so membership is a set lookup and not a field on every
 * booking read.
 */
export interface FavouriteDriversState {
  favourites: FavouriteDriversResponse['favourites'];
  /** The server's own cap, so the UI never hardcodes a number only the API enforces. */
  max: number;
  loading: boolean;
  isFavourite: (driverId: string) => boolean;
  /** True once the list is full — the heart on a driver NOT already in it should say so. */
  isFull: boolean;
  toggle: (driverId: string) => void;
  /** True while any toggle is in flight, so a heart can disable itself rather than queue taps. */
  saving: boolean;
  error: Error | null;
}

export function useFavouriteDrivers(): FavouriteDriversState {
  const client = useQueryClient();

  const query = useQuery({
    queryKey: keys.favourites.all(),
    queryFn: listFavouriteDrivers,
    /*
     * Long-ish. A favourites list changes when this customer changes it — and when they do, the
     * mutation below writes the answer into the cache directly, so a short window would only ever
     * buy re-fetches of a list that cannot have moved.
     */
    staleTime: 5 * 60_000,
  });

  const favourites = query.data?.favourites ?? [];
  const ids = new Set(favourites.map((driver) => driver.id));

  const mutation = useMutation({
    mutationFn: (driverId: string) =>
      ids.has(driverId) ? removeFavouriteDriver(driverId) : addFavouriteDriver(driverId),
    /*
     * The server answers with the WHOLE list, so there is nothing to invalidate and no second
     * round trip: what comes back is the new state of every heart in the app.
     *
     * No optimistic update. The add can legitimately fail — the cap, or a driver this customer
     * never actually rode with — and a heart that fills and then empties again is worse than one
     * that takes a moment. `saving` is what the button uses in the meantime.
     */
    onSuccess: (response) => {
      client.setQueryData(keys.favourites.all(), response);
    },
  });

  return {
    favourites,
    max: query.data?.max ?? 0,
    loading: query.isPending,
    /*
     * A plain closure over the set, rebuilt each render rather than memoised. Memoising it would
     * need the ids as a dependency, which means serialising them on every render — more work than
     * the lookup it was trying to save, on a list capped at twenty.
     */
    isFavourite: (driverId: string) => ids.has(driverId),
    isFull: query.data !== undefined && favourites.length >= query.data.max,
    toggle: (driverId: string) => mutation.mutate(driverId),
    saving: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error : null,
  };
}
