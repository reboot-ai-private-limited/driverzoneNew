'use client';

import { useQuery } from '@tanstack/react-query';
import type { AdminFinanceTransactionsQuery } from '@driverzone/contracts';
import { financeApi } from '@/lib/api/endpoints/finance';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/** Every money movement, newest first, with totals over the whole filtered selection. */
export function useFinanceTransactions(query: AdminFinanceTransactionsQuery) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.finance.transactions(query),
      fetch: (token, signal) => financeApi.transactions(token, query, signal),
      staleTime: staleTime.finance,
    }),
  );
}
