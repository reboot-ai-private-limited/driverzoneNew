import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import type {
  AdminDriverDetailsDto,
  AdminDriverWalletDetailsDto,
  AdminDriverDutyHistoryDto,
  ApproveDriverResponse,
  RejectDriverRequest,
  RejectDriverResponse,
} from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { withAuth } from '@/lib/auth/session';

/**
 * `enabled` defaults to `true` — the original signature, still exactly how `DriverDetailsScreen`
 * calls it with an id straight off the route. It exists for a second caller
 * (`BookingDetailsScreen`'s driver card) that only sometimes has a driver to look up: without it,
 * an unassigned booking would still fire `GET /admin/drivers/` on every render, the same trap
 * `useCustomer` documents avoiding with its own `id: string | undefined` signature.
 */
export function useDriverDetails(id: string, enabled = true) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'drivers', id],
      fetch: (token, signal) => request<AdminDriverDetailsDto>(`/admin/drivers/${id}`, { token, signal }),
      enabled,
    })
  );
}

export function useDriverWallet(id: string) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'drivers', id, 'wallet'],
      fetch: (token, signal) => request<AdminDriverWalletDetailsDto>(`/admin/drivers/${id}/wallet`, { token, signal }),
    })
  );
}

export function useDriverDutyHistory(id: string) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'drivers', id, 'duty'],
      fetch: (token, signal) => request<AdminDriverDutyHistoryDto>(`/admin/drivers/${id}/duty-history`, { token, signal }),
    })
  );
}

export function useApproveDriver(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      return withAuth((token) =>
        request<ApproveDriverResponse>(`/admin/drivers/${id}/approve`, {
          method: 'POST',
          token,
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers'] });
    },
  });
}

export function useRejectDriver(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: RejectDriverRequest) => {
      return withAuth((token) =>
        request<RejectDriverResponse>(`/admin/drivers/${id}/reject`, {
          method: 'POST',
          body: data,
          token,
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers'] });
    },
  });
}
