'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminDriverBalancesQuery } from '@driverzone/contracts';
import { financeApi } from '@/lib/api/endpoints/finance';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * Every driver with ledger activity, and what they stand at.
 *
 * `staleTime.finance` rather than `live`: the endpoint groups over the whole ledger, so a zero
 * stale window would re-run that scan on every keystroke in the search box.
 */
export function useDriverBalances(query: AdminDriverBalancesQuery) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.finance.driverBalances(query),
      fetch: (token, signal) => financeApi.driverBalances(token, query, signal),
      staleTime: staleTime.finance,
    }),
  );
}
