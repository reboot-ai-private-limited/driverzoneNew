'use client';

import { useQuery } from '@tanstack/react-query';
import { faqApi } from '@/lib/api/endpoints/faq';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * Every FAQ, drafts included, in display order.
 *
 * `refetchOnWindowFocus` is OFF, same as `useSettings` and for the same reason — this is a form,
 * and a refetch mid-edit either discards the admin's work or leaves the baseline disagreeing with
 * the screen.
 *
 * It matters more here than it does for settings, because the save REPLACES the list: a refetch
 * that quietly reseeded the drafts could take away rows the admin had just added, and then the
 * save would delete them from the database to match. `FaqPanel` reseeds only from a save's own
 * response for exactly that reason.
 */
export function useFaqs() {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.faq.all(),
      fetch: (token, signal) => faqApi.list(token, signal),
      staleTime: staleTime.configuration,
      refetchOnWindowFocus: false,
    }),
  );
}
