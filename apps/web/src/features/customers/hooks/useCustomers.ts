'use client';

import { useQuery } from '@tanstack/react-query';
import { customersApi, type ListCustomersQuery } from '@/lib/api/endpoints/customers';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/**
 * The customer list. Filtering, sorting and paging all happen server-side, so the query object
 * is part of the key and every change is a new fetch — `keepPreviousData` in the factory is what
 * stops the table blanking between them.
 *
 * No `refetchOnWindowFocus`, unlike zones. Zone configuration is edited by several admins who
 * need to see each other's work; a customer directory is read far more than it is written, and
 * re-fetching a paged, searched list every time the tab regains focus is a request per glance.
 */
export function useCustomers(query: ListCustomersQuery) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.customers.list(query),
      fetch: (token, signal) => customersApi.list(token, query, signal),
      staleTime: staleTime.directory,
    }),
  );
}
