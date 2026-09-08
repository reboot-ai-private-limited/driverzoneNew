'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Coins, HandCoins, RotateCcw, Users, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  DataState,
  DataTable,
  FilterBar,
  FilterField,
  Pagination,
  SearchInput,
  Select,
  SkeletonTable,
  StatTile,
  TopProgressBar,
  type Column,
} from '@driverzone/design-system';
import type { AdminDriverBalancesQuery, DriverBalanceRowDto } from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatMobile } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useDriverBalances } from '../hooks/useDriverBalances';
import { driverBalancesSheet } from '../lib/export';
import { ExportBar } from './ExportBar';
import { SettleDriverDialog } from './SettleDriverDialog';

const PAGE_SIZE = 20;

/** The skeleton uses the SAME widths as the columns, so nothing shifts when the data lands. */
const COLUMN_WIDTHS = ['w-56', 'w-36', 'w-36', 'w-36', 'w-32', 'w-28', 'w-24'];

type FilterKey = 'q' | 'state' | 'suspended' | 'sort' | 'page';

export function DriverBalancesTab() {
  const params = useFilterParams<FilterKey>();
  const router = useRouter();

  const [settling, setSettling] = useState<DriverBalanceRowDto | undefined>(undefined);

  const [typed, setTyped] = useState(() => params.get('q'));
  const search = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (search !== params.get('q')) params.set({ q: search, page: undefined });
  }, [search, params]);

  const state = params.get('state') || 'ALL';
  const suspended = params.get('suspended') === 'true';
  const sort = params.get('sort') || 'BALANCE_ASC';
  const page = Math.max(1, Number(params.get('page')) || 1);

  /** Memoised because it is a QUERY KEY — a fresh object every render is a refetch every render. */
  const query = useMemo<AdminDriverBalancesQuery>(
    () => ({
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      ...(state === 'ALL' ? {} : { state: state as AdminDriverBalancesQuery['state'] }),
      ...(suspended ? { suspended: true } : {}),
      sort: sort as AdminDriverBalancesQuery['sort'],
      page,
      limit: PAGE_SIZE,
    }),
    [search, state, suspended, sort, page],
  );

  const balances = useDriverBalances(query);
  const data = balances.data;
  const rows = data?.rows ?? [];
  const filtered = search.trim() !== '' || state !== 'ALL' || suspended;

  const STATE_LABELS: Record<string, string> = {
    OWED_TO_COMPANY: 'Owes the company',
    OWED_TO_DRIVER: 'We owe them',
    SETTLED: 'Settled (zero)',
  };
  const filterSummary = [
    search.trim() === '' ? null : `Search: "${search.trim()}"`,
    state === 'ALL' ? null : `Balance: ${STATE_LABELS[state] ?? state}`,
    suspended ? 'Suspended only' : null,
  ].filter((line): line is string => line !== null);

  const columns: Column<DriverBalanceRowDto>[] = [
    {
      key: 'driver',
      header: 'Driver',
      width: COLUMN_WIDTHS[0] ?? '',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">
            {row.name ?? <span className="text-text-subtle">Unnamed</span>}
          </span>
          {row.phone !== null && (
            <span className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-text-subtle">
              {formatMobile(row.phone)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'owed',
      header: 'Owed to company',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[1] ?? '',
      render: (row) =>
        row.owed_to_company.amount_paise === 0 ? (
          <span className="text-text-subtle">—</span>
        ) : (
          <span className="whitespace-nowrap font-semibold text-danger">
            {row.owed_to_company.amount_display}
          </span>
        ),
    },
    {
      key: 'payable',
      header: 'Payable to driver',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[2] ?? '',
      render: (row) =>
        row.payable_to_driver.amount_paise === 0 ? (
          <span className="text-text-subtle">—</span>
        ) : (
          <span className="whitespace-nowrap font-semibold text-success">
            {row.payable_to_driver.amount_display}
          </span>
        ),
    },
    {
      key: 'lifetime',
      header: 'Lifetime earnings',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[3] ?? '',
      render: (row) => (
        <span className="whitespace-nowrap">{row.lifetime_earnings.amount_display}</span>
      ),
    },
    {
      key: 'activity',
      header: 'Last entry',
      numeric: true,
      width: COLUMN_WIDTHS[4] ?? '',
      // `last_entry_at` is typed nullable but is never null in practice — a driver only reaches
      // this list by having rows, and the date is the max over them. Handled anyway rather than
      // asserted, because the contract is what the next reader will trust.
      render: (row) => (
        <div className="flex flex-col">
          <span className="whitespace-nowrap">
            {row.last_entry_at === null ? '—' : formatDate(row.last_entry_at)}
          </span>
          <span className="mt-0.5 text-xs text-text-subtle">
            {row.entry_count} {row.entry_count === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: COLUMN_WIDTHS[5] ?? '',
      render: (row) =>
        row.is_suspended_for_balance ? (
          <Badge tone="danger" className="whitespace-nowrap">
            Suspended
          </Badge>
        ) : (
          <span className="text-text-subtle">—</span>
        ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: COLUMN_WIDTHS[6] ?? '',
      render: (row) => (
        <div className="print:hidden">
          {/*
            Disabled at zero rather than hidden: a settled driver still belongs in this table, and
            a button that appears and disappears per row is harder to read than one that is
            visibly unavailable. The server refuses a zero-balance settlement too.
          */}
          <Button
            size="sm"
            variant="ghost"
            disabled={row.balance.amount_paise === 0}
            onClick={(e) => {
              e.stopPropagation();
              setSettling(row);
            }}
          >
            Settle
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Owed to the company"
          icon={<HandCoins aria-hidden className="size-4" />}
          loading={balances.isLoading}
          tone="danger"
          value={data?.totals.total_owed_to_company.amount_display ?? '—'}
          hint={
            data === undefined
              ? undefined
              : `Across ${data.totals.drivers_in_debt} ${data.totals.drivers_in_debt === 1 ? 'driver' : 'drivers'}`
          }
        />
        <StatTile
          label="Payable to drivers"
          icon={<Wallet aria-hidden className="size-4" />}
          loading={balances.isLoading}
          tone="success"
          value={data?.totals.total_payable_to_drivers.amount_display ?? '—'}
          hint={
            data === undefined
              ? undefined
              : `Across ${data.totals.drivers_in_credit} ${data.totals.drivers_in_credit === 1 ? 'driver' : 'drivers'}`
          }
        />
        <StatTile
          label="Suspended"
          icon={<AlertTriangle aria-hidden className="size-4" />}
          loading={balances.isLoading}
          tone={(data?.totals.suspended_count ?? 0) > 0 ? 'warning' : 'default'}
          value={String(data?.totals.suspended_count ?? 0)}
          hint="Past the negative-balance limit"
        />
        <StatTile
          label="Drivers with activity"
          icon={<Users aria-hidden className="size-4" />}
          loading={balances.isLoading}
          value={String(data?.totals.drivers ?? 0)}
          hint={filtered ? 'Matching the filter' : 'All time'}
        />
      </div>

      <FilterBar className="print:hidden">
        <FilterField label="Search" className="min-w-64 flex-1">
          <SearchInput
            value={typed}
            onChange={setTyped}
            placeholder="Search by driver name or mobile"
          />
        </FilterField>
        <FilterField label="Balance">
          <Select
            value={state}
            onValueChange={(value) =>
              params.set({ state: value === 'ALL' ? undefined : value, page: undefined })
            }
            options={[
              { value: 'ALL', label: 'All drivers' },
              { value: 'OWED_TO_COMPANY', label: 'Owes the company' },
              { value: 'OWED_TO_DRIVER', label: 'We owe them' },
              { value: 'SETTLED', label: 'Settled (zero)' },
            ]}
          />
        </FilterField>
        <FilterField label="Suspended">
          <Select
            value={suspended ? 'true' : 'ALL'}
            onValueChange={(value) =>
              params.set({ suspended: value === 'true' ? 'true' : undefined, page: undefined })
            }
            options={[
              { value: 'ALL', label: 'Any' },
              { value: 'true', label: 'Suspended only' },
            ]}
          />
        </FilterField>
        <FilterField label="Sort">
          <Select
            value={sort}
            onValueChange={(value) =>
              params.set({ sort: value === 'BALANCE_ASC' ? undefined : value, page: undefined })
            }
            options={[
              { value: 'BALANCE_ASC', label: 'Deepest debt first' },
              { value: 'BALANCE_DESC', label: 'Most owed to driver' },
              { value: 'LAST_ACTIVITY_DESC', label: 'Most recent activity' },
            ]}
          />
        </FilterField>
        {/*
          No sort by name, and that is a constraint rather than an omission: the pager sorts
          inside the ledger, and a driver's name lives in a different collection entirely. Name
          is the search box.
        */}
        <FilterField label="&nbsp;">
          <Button
            variant="ghost"
            disabled={!filtered && sort === 'BALANCE_ASC'}
            onClick={() => {
              setTyped('');
              params.set({
                q: undefined,
                state: undefined,
                suspended: undefined,
                sort: undefined,
                page: undefined,
              });
            }}
          >
            <RotateCcw aria-hidden className="size-4" />
            Reset
          </Button>
        </FilterField>
      </FilterBar>

      <section className="overflow-hidden rounded-md border border-border bg-surface print:overflow-visible print:rounded-none print:border-0">
        <ExportBar
          title="Driver balances"
          filterSummary={filterSummary}
          sheet={() => driverBalancesSheet(rows)}
          count={rows.length}
          total={data?.pagination.total_items ?? 0}
          page={page}
          pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
          slug="driver-balances"
          noun="drivers"
        />

        <div className="print:hidden">
          <TopProgressBar active={balances.isFetching && !balances.isLoading} />
        </div>

        <DataState
          loading={balances.isLoading}
          error={
            balances.isError
              ? toErrorState(balances.error, () => void balances.refetch())
              : undefined
          }
          empty={rows.length === 0}
          emptyState={{
            icon: <Coins aria-hidden className="size-6" />,
            title: filtered ? 'No drivers match those filters' : 'No driver has any ledger activity',
            /*
             * Says "with activity", not "no drivers". A driver who has never completed a trip has
             * no ledger rows, so they are legitimately absent from a screen about who owes what —
             * and somebody would otherwise report that as missing data.
             */
            description: filtered
              ? 'Try a different balance state, or clear the search.'
              : 'A driver appears here once they have earned or collected anything. The full roster is on the Drivers screen.',
          }}
          skeleton={<SkeletonTable rows={8} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.driver_id}
            // Straight to their statement — the ledger behind the number on this row.
            onRowClick={(row) => router.push(`/drivers/${row.driver_id}`)}
            refetching={balances.isFetching && !balances.isLoading}
          />
          <div className="print:hidden">
            <Pagination
              page={page}
              pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
              total={data?.pagination.total_items ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => params.set({ page: next === 1 ? undefined : String(next) })}
            />
          </div>
        </DataState>
      </section>

      <SettleDriverDialog driver={settling} onClose={() => setSettling(undefined)} />
    </div>
  );
}
