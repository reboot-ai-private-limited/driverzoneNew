import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import type {
  AdminDriverDetailsDto,
  AdminDriverWalletDetailsDto,
  AdminDriverDutyHistoryDto,
  ApproveDriverResponse,
  RejectDriverRequest,
  RejectDriverResponse,
  ReviewDocumentRequest,
  ReviewDocumentResponse,
  VerifyHillDrivingRequest,
  VerifyHillDrivingResponse,
  SuspendDriverRequest,
  SuspendDriverResponse,
  AdminUpdateDriverRequest,
  DriverProfileDto,
} from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { withAuth } from '@/lib/auth/session';

export function useDriverDetails(id: string | undefined) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'drivers', id ?? ''],
      fetch: (token, signal) => request<AdminDriverDetailsDto>(`/admin/drivers/${id}`, { token, signal }),
      enabled: Boolean(id),
    })
  );
}

export function useDriverWallet(id: string | undefined, fromDate?: string, toDate?: string) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'drivers', id ?? '', 'wallet', fromDate, toDate],
      fetch: (token, signal) => {
        const params = new URLSearchParams();
        if (fromDate) params.append('from_date', fromDate);
        if (toDate) params.append('to_date', toDate);
        const qs = params.toString() ? `?${params.toString()}` : '';
        return request<AdminDriverWalletDetailsDto>(`/admin/drivers/${id}/wallet${qs}`, { token, signal });
      },
      enabled: Boolean(id),
    })
  );
}

export function useDriverDutyHistory(id: string | undefined) {
  return useQuery(
    authedQueryOptions({
      queryKey: ['admin', 'drivers', id ?? '', 'duty'],
      fetch: (token, signal) => request<AdminDriverDutyHistoryDto>(`/admin/drivers/${id}/duty-history`, { token, signal }),
      enabled: Boolean(id),
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

export function useReviewDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ docId, data }: { docId: string; data: ReviewDocumentRequest }) => {
      return withAuth((token) =>
        request<ReviewDocumentResponse>(`/admin/drivers/${id}/documents/${docId}`, {
          method: 'PATCH',
          body: data,
          token,
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers', id] });
    },
  });
}

export function useVerifyHillDriving(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: VerifyHillDrivingRequest) => {
      return withAuth((token) =>
        request<VerifyHillDrivingResponse>(`/admin/drivers/${id}/verify-hill`, {
          method: 'PATCH',
          body: data,
          token,
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers', id] });
    },
  });
}

export function useSuspendDriver(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: SuspendDriverRequest) => {
      return withAuth((token) =>
        request<SuspendDriverResponse>(`/admin/drivers/${id}/suspend`, {
          method: 'PATCH',
          body: data,
          token,
        })
      );
    },
    onSuccess: () => {
      // Invalidate the list AND the specific driver's details
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers', id] });
    },
  });
}

export function useToggleSuspendDriver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_suspended, reason }: { id: string; is_suspended: boolean; reason: string }) => {
      return withAuth((token) =>
        request<SuspendDriverResponse>(`/admin/drivers/${id}/suspend`, {
          method: 'PATCH',
          body: { is_suspended, reason },
          token,
        })
      );
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers', variables.id] });
    },
  });
}

export function useUpdateDriver(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: AdminUpdateDriverRequest) => {
      return withAuth((token) =>
        request<DriverProfileDto>(`/admin/drivers/${id}`, {
          method: 'PATCH',
          body: data,
          token,
        })
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'drivers', id] });
    },
  });
}

