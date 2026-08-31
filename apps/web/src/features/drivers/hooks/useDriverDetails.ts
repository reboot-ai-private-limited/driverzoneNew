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

export function useDriverDetails(id: string) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'drivers', id],
      fetch: (token, signal) => request<AdminDriverDetailsDto>(`/admin/drivers/${id}`, { token, signal }),
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
