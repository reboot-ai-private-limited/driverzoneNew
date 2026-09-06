'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminCustomerWalletsQuery, GrantWalletCreditRequest } from '@driverzone/contracts';
import { financeApi } from '@/lib/api/endpoints/finance';
import { withAuth } from '@/lib/auth/session';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';

/** Customers holding credit or carrying an unpaid fee. */
export function useCustomerWallets(query: AdminCustomerWalletsQuery) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.finance.customerWallets(query),
      fetch: (token, signal) => financeApi.customerWallets(token, query, signal),
      staleTime: staleTime.finance,
    }),
  );
}

/**
 * Grants credit, applies a fine, or posts a correction.
 *
 * Invalidates the whole `finance` root rather than one key: a grant changes this customer's row,
 * the totals above it, and (once customer rows join it) the transactions feed. Invalidating the
 * narrower thing is how a screen ends up showing a stale total beside a fresh row.
 */
export function useGrantWalletCredit(customerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: GrantWalletCreditRequest) =>
      withAuth((token) => financeApi.grantWalletCredit(token, customerId, body)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.finance.all() });
      /*
       * The WHOLE customers root, not `detail(customerId)`.
       *
       * `detail` is `['customers','detail',id]` and the statement is
       * `['customers','wallet',id,query]` — sibling branches, so invalidating detail does NOT
       * reach the wallet. This dialog is now mounted in two places, and on the customer's own
       * page the section it changes is exactly the one a narrower key would have missed: the
       * grant would succeed and the rows and balance beside it would not move.
       */
      void queryClient.invalidateQueries({ queryKey: keys.customers.all() });
    },
  });
}
