'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, UserCheck, Clock } from 'lucide-react';
import type { DriverProfileDto, OnboardingStatus } from '@driverzone/contracts';
import {
  Badge,
  CellStack,
  DataState,
  DataTable,
  FilterBar,
  FilterField,
  PageHeader,
  Pagination,
  SearchInput,
  SkeletonTable,
  StatusPill,
  TopProgressBar,
  type Column,
  cn,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useDrivers } from '../hooks/useDrivers';

const PAGE_SIZE = 15;
const COLUMN_WIDTHS = ['w-64', 'w-40', 'w-32', 'w-32', 'w-32'];

type FilterKey = 'q' | 'status' | 'tab' | 'page';

export function DriversScreen() {
  const params = useFilterParams<FilterKey>();
  const router = useRouter();

  const [typed, setTyped] = useState(() => params.get('q'));
  const search = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (search !== params.get('q')) params.set({ q: search, page: undefined });
  }, [search, params]);

  const status = (params.get('status') || 'ALL') as OnboardingStatus | 'ALL';
  const tab = (params.get('tab') || 'verified') as 'verified' | 'requests';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const query = useDrivers({
    page,
    limit: PAGE_SIZE,
    search: search.trim(),
    onboarding_status: tab === 'verified' ? 'ALL' : status,
    is_verified: tab === 'verified' ? 'true' : 'false',
  });

  const columns: Column<DriverProfileDto>[] = [
    {
      key: 'name',
      header: 'Driver',
      width: COLUMN_WIDTHS[0] ?? '',
      render: (driver) => <CellStack primary={driver.full_name || 'Unnamed'} secondary={driver.mobile_number} />,
    },
    {
      key: 'vehicles',
      header: 'Prefers',
      width: COLUMN_WIDTHS[1] ?? '',
      render: (driver) => {
        if (!driver.vehicle_type_preference && driver.vehicle_category_preference.length === 0) {
          return <span className="text-text-subtle">—</span>;
        }
        return (
          <CellStack
            primary={driver.vehicle_category_preference.join(', ') || 'Any'}
            secondary={driver.vehicle_type_preference ?? 'Any Type'}
          />
        );
      },
    },
    {
      key: 'hill',
      header: 'Hill Ready',
      width: COLUMN_WIDTHS[2] ?? '',
      render: (driver) => (
        <Badge tone={driver.can_drive_hill_verified ? 'success' : driver.can_drive_hill ? 'warning' : 'neutral'}>
          {driver.can_drive_hill_verified ? 'Verified' : driver.can_drive_hill ? 'Declared' : 'No'}
        </Badge>
      ),
    },
    {
      key: 'onboarding',
      header: 'Onboarding',
      width: COLUMN_WIDTHS[3] ?? '',
      render: (driver) => <StatusPill status={driver.onboarding_status} />,
    },
    {
      key: 'verified',
      header: 'Verified (Duty)',
      width: COLUMN_WIDTHS[4] ?? '',
      render: (driver) => (
        <Badge tone={driver.is_verified ? 'success' : 'neutral'}>
          {driver.is_verified ? 'Yes' : 'No'}
        </Badge>
      ),
    },
  ];

  const totalItems = query.data?.pagination.total_items ?? 0;
  const pageCount = query.data?.pagination.total_pages ?? 1;
  const rows = query.data?.drivers ?? [];

  return (
    <>
      <PageHeader
        title="Drivers"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Drivers' }]}
        actions={
          <div className="flex bg-surface-sunken p-1 rounded-md border border-border">
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded transition-colors",
                tab === 'verified'
                  ? "bg-surface shadow-sm text-text"
                  : "text-text-subtle hover:text-text"
              )}
              onClick={() => params.set({ tab: 'verified', page: undefined, status: undefined })}
            >
              <UserCheck className="size-4" />
              Verified Drivers
            </button>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded transition-colors",
                tab === 'requests'
                  ? "bg-surface shadow-sm text-text"
                  : "text-text-subtle hover:text-text"
              )}
              onClick={() => params.set({ tab: 'requests', page: undefined, status: undefined })}
            >
              <Clock className="size-4" />
              Requests / Pending
            </button>
          </div>
        }
      />

      <FilterBar>
        <FilterField label="Search" className="flex-1 min-w-64">
          <SearchInput value={typed} onChange={setTyped} placeholder="Search by name or phone" />
        </FilterField>
      </FilterBar>

      <section className="bg-surface border border-border rounded-md overflow-hidden">
        <TopProgressBar active={query.isFetching && !query.isLoading} />

        <DataState
          loading={query.isLoading}
          error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
          empty={rows.length === 0}
          emptyState={{
            icon: <Users aria-hidden className="size-6" />,
            title: 'No drivers found',
            description: 'Try adjusting your search or filters.',
          }}
          skeleton={<SkeletonTable rows={10} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(driver) => driver.id}
            onRowClick={(driver) => router.push(`/drivers/${driver.id}`)}
            refetching={query.isFetching && !query.isLoading}
          />
          <Pagination
            page={page}
            pageCount={pageCount}
            total={totalItems}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => params.set({ page: next === 1 ? undefined : String(next) })}
          />
        </DataState>
      </section>
    </>
  );
}
