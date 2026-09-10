import type { GetFaqsResponse, ReplaceFaqsRequest, ReplaceFaqsResponse } from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/faq` — mirrors `apps/api/src/modules/faq/interface/faq.routes.ts` one-for-one.
 *
 * READS TAKE A TRAILING `signal`; WRITES DO NOT — same rule as `endpoints/zones.ts`, for the same
 * reason.
 */
export const faqApi = {
  /** Every entry, drafts included. The apps get the published ones from their own routes. */
  list: (token: string, signal?: AbortSignal) => request<GetFaqsResponse>('/admin/faq', { token, signal }),

  /**
   * THE WHOLE LIST, IN ORDER, EVERY TIME — and it is a PUT because that is what it does.
   *
   * `sort_order` is not sent: the server assigns it from array position. Reordering is the
   * ordinary edit and it moves every row at once, so a per-row API would turn one drag into N
   * requests that can half-fail.
   *
   * IT DELETES. A stored entry whose id is missing from `faqs` is removed, so this must only ever
   * be called with a list built from a FRESH read — see the refetch-before-save note in
   * `FaqPanel`. No idempotency key: replaying it writes the same list to the same place.
   */
  replace: (token: string, body: ReplaceFaqsRequest) =>
    request<ReplaceFaqsResponse>('/admin/faq', { method: 'PUT', token, body }),
};
