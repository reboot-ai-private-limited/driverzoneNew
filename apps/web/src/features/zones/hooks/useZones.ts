'use client';

import { useQuery } from '@tanstack/react-query';
import type { ListZonesQuery } from '@driverzone/contracts';
import { zonesApi } from '@/lib/api/endpoints/zones';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * The list. `authedQueryOptions` supplies the token, the abort signal and `keepPreviousData` —
 * see `lib/query/factory.ts` for why none of those are worth re-deciding per hook.
 */
export function useZones(query?: ListZonesQuery) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.zones.list(query),
      fetch: (token, signal) => zonesApi.list(token, query, signal),
      staleTime: staleTime.configuration,
      // Zone configuration is edited by a handful of people who need to see each other's work,
      // so coming back to the tab should show what changed.
      refetchOnWindowFocus: true,
    }),
  );
}
