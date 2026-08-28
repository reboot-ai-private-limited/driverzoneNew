'use client';

import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api/endpoints/settings';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * Every setting, grouped, in one read.
 *
 * `refetchOnWindowFocus` is OFF here, unlike zones. This screen is a form: a refetch while an
 * admin has half a dozen boxes edited would either discard their work or leave the "changed from"
 * baseline disagreeing with what is on screen. Configuration edited by two people at once is a
 * real concern, and it is handled at save time — the server refuses an incoherent result — not by
 * pulling the rug mid-edit.
 */
export function useSettings() {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.settings.all(),
      fetch: (token, signal) => settingsApi.list(token, signal),
      staleTime: staleTime.configuration,
      refetchOnWindowFocus: false,
    }),
  );
}
