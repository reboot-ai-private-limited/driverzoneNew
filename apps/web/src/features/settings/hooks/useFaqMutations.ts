'use client';

import type { ReplaceFaqsRequest, ReplaceFaqsResponse } from '@driverzone/contracts';
import { faqApi } from '@/lib/api/endpoints/faq';
import { keys } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

/**
 * The one FAQ write. There is no create/update/delete trio because the API has none: the list is
 * saved whole, which is what makes a reorder a single request instead of one per moved row.
 *
 * No success toast here — the caller reseeds its drafts from the response before anything is
 * really settled, and toasts there. Errors still toast via `useApiMutation`, and a stale-list
 * rejection (422 `FAQ_NOT_FOUND`) carries the ids so the panel can point at the rows that went
 * away underneath it.
 */
export function useReplaceFaqs(onSaved?: (result: ReplaceFaqsResponse) => void) {
  return useApiMutation<ReplaceFaqsRequest, ReplaceFaqsResponse>({
    call: (token, body) => faqApi.replace(token, body),
    invalidates: [keys.faq.all()],
    ...(onSaved === undefined ? {} : { onSuccess: onSaved }),
  });
}
