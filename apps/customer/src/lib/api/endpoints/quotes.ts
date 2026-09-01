import type {
  CreateQuoteRequest,
  CreateQuoteResponse,
  UnavailableResult,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `POST /customer/quotes` — apps/api/src/modules/quotes/interface/quotes.routes.ts.
 *
 * THE CLIENT NEVER SENDS A PRICE and never computes one. It sends two coordinates, receives
 * `quote_id`s with fares already rendered, and hands the chosen id to `POST /bookings`. Every
 * money field arrives as `Money` — paise to compare with, `amount_display` to render — so no
 * screen formats currency itself (packages/contracts/src/http.ts).
 *
 * Rate limited to 30/min PER CUSTOMER, not per IP. Generous for a person tapping Continue,
 * tight enough that a re-render loop calling this will be noticed. Which is the main reason the
 * fare screen re-quotes on an explicit action rather than on React Query's focus refetch.
 */

/**
 * THE RESPONSE IS A UNION AND THE CONTRACT DOES NOT SAY SO — this is the one thing about this
 * endpoint that will bite a caller who reads `CreateQuoteResponse` and stops there.
 *
 * "We cannot serve this trip" is not an error. An unserved pickup point, no package covering the
 * distance, no road between the points — all answer **200** with `UnavailableResult`, deliberately,
 * so they stay out of the error dashboards and the app renders a helpful screen instead of a
 * generic failure (`quotes.controller.ts`, and docs/LLD/zone-resolution.md §Error codes).
 *
 * So the success path has two shapes, and only 4xx/5xx reach `catch`. A caller that types this as
 * `CreateQuoteResponse` alone compiles fine and then reads `options` off an unavailable answer.
 */
export type CreateQuoteResult = CreateQuoteResponse | UnavailableResult;

/**
 * Narrows the union above. Keyed on `available`, which exists ONLY on the unavailable branch —
 * the served response has no `available: true` to test, so the check cannot be inverted.
 */
export function isUnavailable(result: CreateQuoteResult): result is UnavailableResult {
  return 'available' in result && result.available === false;
}

export function createQuote(body: CreateQuoteRequest): Promise<CreateQuoteResult> {
  return request<CreateQuoteResult>(`${ROLE_PREFIX}/quotes`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}
