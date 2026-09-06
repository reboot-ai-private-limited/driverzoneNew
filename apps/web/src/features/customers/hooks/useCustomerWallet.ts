'use client';

import { useQuery } from '@tanstack/react-query';
import type { CustomerWalletQueryParams } from '@driverzone/contracts';
import { customersApi } from '@/lib/api/endpoints/customers';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * One customer's wallet statement, for the section on their detail page.
 *
 * `staleTime.finance` rather than `directory`: this is money someone may be about to act on, and
 * the same window the Finance tab uses — two admin screens quoting the same wallet should not
 * disagree because one of them cached it for a minute.
 */
export function useCustomerWallet(id: string | undefined, query?: CustomerWalletQueryParams) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.customers.wallet(id ?? '', query),
      fetch: (token, signal) => customersApi.wallet(token, id ?? '', query, signal),
      staleTime: staleTime.finance,
      enabled: id !== undefined,
    }),
  );
}
