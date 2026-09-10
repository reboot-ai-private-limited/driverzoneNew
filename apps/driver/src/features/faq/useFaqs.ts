import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import type { FaqDto } from '@driverzone/contracts';
import { listFaqs } from '@/lib/api/endpoints/faq';
import { keys } from '@/lib/query/keys';
import { readCachedFaqs, writeCachedFaqs } from './faqCache';

export interface FaqsState {
  faqs: FaqDto[];
  /** True while what is on screen came off the disk rather than the server. */
  fromCache: boolean;
  /** When the cached copy was taken. `null` unless `fromCache`. */
  cachedAt: Date | null;
  loading: boolean;
  /** Set only when there is nothing to show — a failure with a cached copy is not an error state. */
  error: Error | null;
  refetch: () => void;
}

/**
 * The FAQs, with the last known good copy standing in whenever the network cannot answer.
 *
 * THREE OUTCOMES, NOT TWO. A fetch that fails with a cached copy on disk is not an error — it is
 * a slightly old answer, which is worth far more than a retry button to a driver at the roadside
 * being asked what the customer owes them. Only a failure with nothing cached is an error the
 * screen should report.
 *
 * The cache is READ ONCE, synchronously, into a ref: reading it on every render would hit the
 * disk on every keystroke-free re-render, and reading it in an effect would show an empty state
 * for one frame first — which is the flicker the whole mechanism exists to remove.
 */
export function useFaqs(): FaqsState {
  const cached = useRef<ReturnType<typeof readCachedFaqs>>(undefined);
  if (cached.current === undefined) cached.current = readCachedFaqs();

  const query = useQuery({
    queryKey: keys.faqs.all(),
    queryFn: async ({ signal }) => {
      const response = await listFaqs(signal);
      // Written on every success, not only the first: the point of the copy is that it is the
      // most recent answer, and an admin correcting a figure should reach a phone that goes
      // offline tomorrow.
      writeCachedFaqs(response.faqs);
      return response;
    },
    /*
     * Long, because FAQs change a few times a year and the screen is opened mid-problem. A short
     * window would re-fetch on every visit and, on bad signal, replace a perfectly good answer
     * with a spinner.
     */
    staleTime: 5 * 60_000,
  });

  const live = query.data?.faqs;
  const fallback = cached.current;

  if (live !== undefined) {
    return {
      faqs: live,
      fromCache: false,
      cachedAt: null,
      loading: false,
      error: null,
      refetch: () => void query.refetch(),
    };
  }

  if (fallback !== null && fallback !== undefined) {
    return {
      faqs: fallback.faqs,
      fromCache: true,
      cachedAt: fallback.savedAt,
      // Still shown as loading while the live copy is on its way, so the screen can say it is
      // checking rather than looking stuck on an old answer.
      loading: query.isPending,
      error: null,
      refetch: () => void query.refetch(),
    };
  }

  return {
    faqs: [],
    fromCache: false,
    cachedAt: null,
    loading: query.isPending,
    error: query.isError ? (query.error as Error) : null,
    refetch: () => void query.refetch(),
  };
}
