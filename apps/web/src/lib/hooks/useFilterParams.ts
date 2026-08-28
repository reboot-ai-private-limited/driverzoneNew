'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Filter, sort and page state, kept in the URL.
 *
 * There is no client state library in this app and there should not be one
 * (docs/engineering/frontend-architecture.md §Server state). The URL is the better store for
 * this particular state anyway: a filtered table survives a reload, and an ops person can paste
 * the exact view they are asking about into a chat window instead of describing it.
 *
 * `router.replace`, never `push`. Every keystroke in a search box is a state change, and pushing
 * them turns the back button into an undo history of typing — twelve presses to leave the page.
 */
export interface FilterParams<K extends string> {
  /** The current value, or `''` when the parameter is absent. */
  get: (key: K) => string;
  /** Set several at once; `undefined` removes a parameter rather than writing an empty one. */
  set: (next: Partial<Record<K, string | undefined>>) => void;
}

export function useFilterParams<K extends string>(): FilterParams<K> {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // The string, not the object: `useSearchParams` returns a new instance on every render, so a
  // dependency on it re-creates `set` every time and defeats memoisation in every consumer.
  const serialised = searchParams.toString();

  const set = useCallback(
    (next: Partial<Record<K, string | undefined>>) => {
      const params = new URLSearchParams(serialised);

      for (const [key, value] of Object.entries(next) as [K, string | undefined][]) {
        // An empty filter is an ABSENT parameter, not `?search=`. Otherwise clearing a search
        // box leaves a URL that looks filtered and a link that is noise to read.
        if (value === undefined || value === '') params.delete(key);
        else params.set(key, value);
      }

      const query = params.toString();
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [router, pathname, serialised],
  );

  return useMemo(
    () => ({ get: (key: K) => new URLSearchParams(serialised).get(key) ?? '', set }),
    [serialised, set],
  );
}
