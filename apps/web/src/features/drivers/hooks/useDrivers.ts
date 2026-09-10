import { useQuery } from '@tanstack/react-query';
import type { AdminDriverListDto, OnboardingStatus } from '@driverzone/contracts';
import { request } from '@/lib/api/client';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys } from '@/lib/query/keys';

export interface UseDriversParams {
  page?: number;
  limit?: number;
  search?: string;
  onboarding_status?: OnboardingStatus | 'ALL';
  is_verified?: 'true' | 'false' | 'ALL';
}

export function useDrivers(params: UseDriversParams) {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.drivers.list(params),
      fetch: (token, signal) => {
        const query: Record<string, string | number | boolean | undefined> = {};
        if (params.page !== undefined) query.page = params.page;
        if (params.limit !== undefined) query.limit = params.limit;
        if (params.search) query.search = params.search;
        if (params.onboarding_status && params.onboarding_status !== 'ALL') {
          query.onboarding_status = params.onboarding_status;
        }
        if (params.is_verified && params.is_verified !== 'ALL') {
          query.is_verified = params.is_verified;
        }
        return request<AdminDriverListDto>('/admin/drivers', { token, signal, query });
      },
    })
  );
}
