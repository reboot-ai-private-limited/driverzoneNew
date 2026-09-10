'use client';

import { useState } from 'react';
import { Clock, Route } from 'lucide-react';
import type { DutySessionDto } from '@driverzone/contracts';
import {
  DataState,
  DataTable,
  Pagination,
  Panel,
  SkeletonTable,
  type Column,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatPaise, formatDate, formatTime } from '@/lib/format';
import { useDriverDutyHistory } from '../hooks/useDriverDetails';

const COLUMN_WIDTHS = ['w-48', 'w-32', 'w-24', 'w-32'];

/**
 * The server's own default, mirrored here so the pager can size itself.
 *
 * `useDriverDutyHistory` sends no `limit`, so this must stay in step with the default in
 * `adminDriverDutyHistoryQuerySchema` — send one from here the moment the two need to differ.
 */
const PAGE_SIZE = 10;

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function DriverDutyHistoryTab({ driverId }: { driverId: string }) {
  const [page, setPage] = useState(1);
  const query = useDriverDutyHistory(driverId, page);

  const columns: Column<DutySessionDto>[] = [
    {
      key: 'time',
      header: 'Shift Timing',
      width: COLUMN_WIDTHS[0] ?? '',
      render: (session) => (
        <div className="flex flex-col">
          <span className="font-medium text-text">{formatDate(session.started_at)}</span>
          <span className="text-xs text-text-subtle mt-0.5 tnum">
            {formatTime(session.started_at)} — {session.ended_at ? formatTime(session.ended_at) : 'Active'}
          </span>
        </div>
      ),
    },
    {
      key: 'duration',
      header: 'Duration',
      width: COLUMN_WIDTHS[1] ?? '',
      render: (session) => (
        <div className="flex items-center gap-1.5">
          <Clock className="size-3 text-text-subtle" />
          <span className="font-medium tnum">{formatDuration(session.duration_minutes)}</span>
        </div>
      ),
    },
    {
      key: 'trips',
      header: 'Trips',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[2] ?? '',
      render: (session) => (
        <div className="flex items-center justify-end gap-1.5">
          <Route className="size-3 text-text-subtle" />
          <span className="font-medium tnum">{session.trips_completed}</span>
        </div>
      ),
    },
    {
      key: 'earnings',
      header: 'Session Earnings',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[3] ?? '',
      render: (session) => (
        <span className="font-medium tnum">{formatPaise(session.earnings_paise)}</span>
      ),
    },
  ];

  if (query.isLoading) {
    return (
      <Panel title="Duty History">
        <SkeletonTable rows={8} columns={COLUMN_WIDTHS} />
      </Panel>
    );
  }

  if (query.isError || !query.data) {
    return (
      <DataState
        loading={false}
        skeleton={<></>}
        error={query.isError ? toErrorState(query.error, () => query.refetch()) : undefined}
      >
        <div />
      </DataState>
    );
  }

  const { sessions, pagination } = query.data;

  return (
    <Panel title="Duty History">
      <DataState
        loading={false}
        skeleton={<></>}
        empty={sessions.length === 0}
        emptyState={{
          icon: <Clock aria-hidden className="size-6" />,
          title: 'No duty sessions yet',
          description: 'This driver has not logged in to duty.',
        }}
      >
        <DataTable
          columns={columns}
          rows={sessions}
          rowKey={(session) => session.id}
          refetching={query.isFetching && !query.isLoading}
        />
        {/* The endpoint has always paged; without this the tab showed the ten most recent shifts
            and nothing said there were more. Same component and placement as the wallet tab. */}
        <Pagination
          page={page}
          pageCount={Math.max(1, pagination.total_pages)}
          total={pagination.total_items}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </DataState>
    </Panel>
  );
}
