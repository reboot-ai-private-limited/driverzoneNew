'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '@/lib/api/endpoints/finance';
import { withAuth } from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';

export interface SettleDriverInput {
  amount_paise: number;
  note: string;
  reference?: string | undefined;
  /**
   * STABLE ACROSS RETRIES. The dialog generates this once when it opens, not once per click —
   * a key that changed per attempt would be no key at all, and the ledger cannot un-write a
   * duplicated settlement.
   */
  idempotencyKey: string;
}

export function useSettleDriver(driverId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: SettleDriverInput) =>
      withAuth((token) => financeApi.settleDriver(token, driverId, body, idempotencyKey)),
    onSuccess: () => {
      // The balance moved, so every finance figure and this driver's own statement are stale.
      void queryClient.invalidateQueries({ queryKey: keys.finance.all() });
      void queryClient.invalidateQueries({ queryKey: keys.drivers.all() });
    },
  });
}
