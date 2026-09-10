import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import type {
  AdminDriverDetailsDto,
  AdminDriverWalletDetailsDto,
  AdminDriverDutyHistoryDto,
  ApproveDriverResponse,
  LedgerQueryParams,
  RejectDriverRequest,
  RejectDriverResponse,
  ReviewDocumentRequest,
  ReviewDocumentResponse,
  VerifyHillDrivingRequest,
  VerifyHillDrivingResponse,
  SuspendDriverResponse,
  AdminUpdateDriverRequest,
  DriverProfileDto,
} from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';
import { withAuth } from '@/lib/auth/session';

export function useDriverDetails(id: string | undefined, enabled = true) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.drivers.detail(id ?? ''),
      fetch: (token, signal) => request<AdminDriverDetailsDto>(`/admin/drivers/${id}`, { token, signal }),
      staleTime: staleTime.directory,
      enabled: Boolean(id) && enabled,
    })
  );
}

export function useDriverWallet(id: string | undefined, query?: LedgerQueryParams) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.drivers.wallet(id ?? '', query),
      fetch: (token, signal) =>
        request<AdminDriverWalletDetailsDto>(`/admin/drivers/${id}/wallet`, {
          token,
          signal,
          ...(query === undefined
            ? {}
            : {
                query: {
                  page: query.page,
                  limit: query.limit,
                  type: query.type,
                  from: query.from,
                  to: query.to,
                },
              }),
        }),
      staleTime: staleTime.directory,
      enabled: Boolean(id),
    })
  );
}

/**
 * One page of a driver's shifts.
 *
 * `page` is a real parameter, not a default nobody passes: the endpoint has always paged at ten
 * per page, and asking without one returned page 1 and nothing else — so the tab showed a driver's
 * ten most recent shifts and gave no sign there were more. The size stays the server's default.
 */
export function useDriverDutyHistory(id: string | undefined, page = 1) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.drivers.dutyHistory(id ?? '', page),
      fetch: (token, signal) =>
        request<AdminDriverDutyHistoryDto>(`/admin/drivers/${id}/duty-history`, {
          token,
          signal,
          query: { page },
        }),
      staleTime: staleTime.directory,
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
      queryClient.invalidateQueries({ queryKey: keys.drivers.all() });
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
      queryClient.invalidateQueries({ queryKey: keys.drivers.all() });
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
      queryClient.invalidateQueries({ queryKey: keys.drivers.all() });
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
      queryClient.invalidateQueries({ queryKey: keys.drivers.all() });
    },
  });
}

/**
 * Suspend or reinstate, from either screen.
 *
 * The driver id travels in the variables rather than being bound at construction, because the
 * list needs whichever row was clicked and the detail page can simply pass its own. There used to
 * be a second hook — `useSuspendDriver(id)` — doing the identical PATCH with the identical body,
 * purely because the two screens each grew their own. One endpoint, one hook.
 */
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.drivers.all() });
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
      queryClient.invalidateQueries({ queryKey: keys.drivers.all() });
    },
  });
}

