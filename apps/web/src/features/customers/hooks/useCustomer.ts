'use client';

import { useQuery } from '@tanstack/react-query';
import { customersApi } from '@/lib/api/endpoints/customers';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * One customer's full record — the addresses, vehicles and emergency contact the list row does
 * not carry.
 *
 * `enabled` is the point of the `id | undefined` signature: both dialogs mount with no customer
 * selected, and a hook that fired anyway would request `/admin/customers/undefined` every time
 * the screen rendered.
 */
export function useCustomer(id: string | undefined) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.customers.detail(id ?? ''),
      fetch: (token, signal) => customersApi.get(token, id ?? '', signal),
      staleTime: staleTime.directory,
      enabled: id !== undefined,
    }),
  );
}
