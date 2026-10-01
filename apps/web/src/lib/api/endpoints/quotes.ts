import type {
  AdminCreateQuoteRequest,
  CreateQuoteResponse,
  Direction,
  ExplainTripResponse,
  UnavailableResult,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * THE QUOTE RESPONSE IS A UNION. "We cannot serve this trip" — an unserved pickup, no package for
 * the distance, no road — is a 200 with `available: false`, not an error, exactly as the customer
 * app receives it. Only 4xx/5xx reach `catch`.
 */
export type AdminQuoteResult = CreateQuoteResponse | UnavailableResult;

export function isUnavailable(result: AdminQuoteResult): result is UnavailableResult {
  return 'available' in result && result.available === false;
}

/**
 * `/admin/quotes` — mirrors the admin half of
 * `apps/api/src/modules/quotes/interface/quotes.routes.ts`.
 *
 * TWO ENDPOINTS. `explain` is a support tool that writes nothing. `create` is a REAL quote, bound
 * to the customer the admin is booking for — the price the panel's New Booking screen shows, and
 * the `quote_id` it books against.
 */
export const quotesApi = {
  create: (token: string, body: AdminCreateQuoteRequest) =>
    request<AdminQuoteResult>('/admin/quotes', { token, method: 'POST', body }),

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
