import type { Direction, ExplainTripResponse } from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/quotes` — mirrors the admin half of
 * `apps/api/src/modules/quotes/interface/quotes.routes.ts`.
 *
 * ONE ENDPOINT, AND IT IS A SUPPORT TOOL. There is no admin quoting: a quote is a customer
 * action, and an admin creating one would consume a row and hand out a price nobody asked for.
 * This only READS how a pair of coordinates would resolve, which is the question behind every
 * "why was this trip charged as an outstation run" ticket.
 */
export const quotesApi = {
  explainTrip: (
    token: string,
    trip: {
      pickupLat: number;
      pickupLng: number;
      dropLat: number;
      dropLng: number;
      direction?: Direction | undefined;
    },
    signal?: AbortSignal,
  ) =>
    request<ExplainTripResponse>('/admin/quotes/explain', {
      token,
      signal,
      query: {
        pickup_lat: trip.pickupLat,
        pickup_lng: trip.pickupLng,
        drop_lat: trip.dropLat,
        drop_lng: trip.dropLng,
        ...(trip.direction === undefined ? {} : { direction: trip.direction }),
      },
    }),
};
