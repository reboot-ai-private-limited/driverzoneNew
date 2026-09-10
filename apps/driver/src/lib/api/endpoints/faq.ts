import type { PublishedFaqsResponse } from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `GET /driver/faq` — the published FAQs, in the order an admin arranged them.
 *
 * THE SAME LIST THE CUSTOMER APP READS, from its own prefix. That is the point rather than a
 * coincidence: these answers describe a trip both sides are on — who pays for the driver's food,
 * what the waiting rules are — and a driver quoting one figure at a customer reading another is
 * exactly the argument the FAQs exist to settle.
 */
export function listFaqs(signal?: AbortSignal): Promise<PublishedFaqsResponse> {
  return request<PublishedFaqsResponse>(`${ROLE_PREFIX}/faq`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}
