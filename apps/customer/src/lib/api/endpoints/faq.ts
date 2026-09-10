import type { PublishedFaqsResponse } from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `GET /customer/faq` — the published FAQs, in the order an admin arranged them.
 *
 * THE DRIVER APP READS THE SAME LIST from its own prefix. That is deliberate rather than
 * incidental: the answers describe a trip both sides are on — most pointedly, who pays for the
 * driver's food on a long journey — and two versions of that answer is the argument these FAQs
 * exist to prevent.
 *
 * Authenticated, like every other route in this API bar the payment webhook. A signed-out user
 * cannot read them; both places that link here are behind login anyway.
 */
export function listFaqs(signal?: AbortSignal): Promise<PublishedFaqsResponse> {
  return request<PublishedFaqsResponse>(`${ROLE_PREFIX}/faq`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}
