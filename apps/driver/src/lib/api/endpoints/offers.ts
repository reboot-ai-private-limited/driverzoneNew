import type {
  AcceptOfferResponse,
  DeclineOfferResponse,
  ListDriverOffersResponse,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { getAccessToken } from '../../auth/session';
import { request } from '../client';

/**
 * `/driver/offers/*` — apps/api/src/modules/dispatch/interface/dispatch.routes.ts.
 *
 * The dispatch surface the driver app touches. Everything else about a wave — ranking, radius
 * escalation, the atomic claim — happens server-side; the app only ever asks what is ringing and
 * answers yes or no.
 */

/**
 * "What is ringing on my phone right now" — every live offer, soonest-expiring first.
 *
 * Also the RECOVERY path: a driver whose app was killed by the OEM battery manager mid-offer
 * comes back to a live offer they would otherwise never see, and which would lapse against
 * their acceptance rate.
 *
 * PLURAL (2026-09-04). A driver can legitimately hold more than one live offer at once — two
 * customers booking near-simultaneously can both dispatch to the same driver, and dispatch's
 * matching does not exclude that. See `ListDriverOffersResponse` for why this replaced a
 * singular "current" offer.
 */
export function listOffers(signal?: AbortSignal): Promise<ListDriverOffersResponse> {
  return request<ListDriverOffersResponse>(`${ROLE_PREFIX}/offers`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}

/**
 * Claim the trip.
 *
 * LOSING THE RACE IS A 200 with `claimed: false`, not an error — four of five drivers lose every
 * wave and each did exactly what was asked. Callers branch on `claimed`, never on catching.
 */
export function acceptOffer(offerId: string): Promise<AcceptOfferResponse> {
  return request<AcceptOfferResponse>(`${ROLE_PREFIX}/offers/${offerId}/accept`, {
    method: 'POST',
    token: getAccessToken() ?? undefined,
  });
}

export function declineOffer(offerId: string): Promise<DeclineOfferResponse> {
  return request<DeclineOfferResponse>(`${ROLE_PREFIX}/offers/${offerId}/decline`, {
    method: 'POST',
    token: getAccessToken() ?? undefined,
  });
}
