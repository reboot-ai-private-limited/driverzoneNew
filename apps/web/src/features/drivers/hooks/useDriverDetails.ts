import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import type {
  AdminDriverDetailsDto,
  AdminDriverWalletDetailsDto,
  AdminDriverDutyHistoryDto,
  ApproveDriverResponse,
  LedgerQueryParams,
  RejectDriverRequest,
  RejectDriverResponse,
} from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';
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

/**
 * One driver's statement.
 *
 * `GET /admin/drivers/:id/wallet` has accepted `page/limit/type/from/to` since 2026-09-04 and
 * returns a `summary` and `pagination` alongside the rows. This hook passed none of them and the
 * tab discarded both, so the screen silently showed the newest ten entries of an eighteen-entry
 * statement with no pager and no way to narrow it. The query is threaded through now.
 */
export function useDriverWallet(id: string, query?: LedgerQueryParams) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.drivers.wallet(id, query),
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
