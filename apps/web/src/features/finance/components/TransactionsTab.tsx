'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Hash, Receipt, RotateCcw, Scale } from 'lucide-react';
import {
  Badge,
  Button,
  DataState,
  DataTable,
  FilterBar,
  FilterField,
  Input,
  Pagination,
  SearchInput,
  Select,
  SkeletonTable,
  StatTile,
  TopProgressBar,
  type Column,
} from '@driverzone/design-system';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  type AdminFinanceTransactionsQuery,
  type FinanceTransactionDto,
  type TransactionType,
} from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatPaise, formatTime } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useFinanceTransactions } from '../hooks/useFinanceTransactions';
import { transactionsSheet } from '../lib/export';
import { ExportBar } from './ExportBar';

const PAGE_SIZE = 25;
const COLUMN_WIDTHS = ['w-32', 'w-44', 'w-40', 'w-32', 'w-24', 'w-56'];

type FilterKey = 'tq' | 'type' | 'from' | 'to' | 'tpage';

export function TransactionsTab() {
  /*
   * Prefixed filter keys (`tq`, `tpage`) so this tab's state cannot collide with the balances
   * tab's `q`/`page` in the same URL. Both tabs live on one route, and a shared `page` would mean
   * paging one tab silently paged the other.
   */
  const params = useFilterParams<FilterKey>();

  const [typed, setTyped] = useState(() => params.get('tq'));
  const search = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (search !== params.get('tq')) params.set({ tq: search, tpage: undefined });
  }, [search, params]);

  const type = params.get('type') || 'ALL';
  const from = params.get('from');
  const to = params.get('to');
  const page = Math.max(1, Number(params.get('tpage')) || 1);

  const query = useMemo<AdminFinanceTransactionsQuery>(
    () => ({
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      ...(type === 'ALL' ? {} : { type }),
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      page,
      limit: PAGE_SIZE,
    }),
    [search, type, from, to, page],
  );

  const feed = useFinanceTransactions(query);
  const data = feed.data;
  const rows = data?.entries ?? [];
  const filtered = search.trim() !== '' || type !== 'ALL' || from !== '' || to !== '';

  const filterSummary = [
    search.trim() === '' ? null : `Search: "${search.trim()}"`,
    type === 'ALL' ? null : `Type: ${TRANSACTION_TYPE_LABELS[type as TransactionType]}`,
    from === '' && to === '' ? null : `Date: ${from || 'any'} to ${to || 'any'}`,
  ].filter((line): line is string => line !== null);

  const columns: Column<FinanceTransactionDto>[] = [
    {
      key: 'when',
      header: 'Date & time',
      numeric: true,
      width: COLUMN_WIDTHS[0] ?? '',
      render: (row) => (
        <div className="flex flex-col">
          <span className="whitespace-nowrap">{formatDate(row.created_at)}</span>
          <span className="mt-0.5 text-xs text-text-subtle">{formatTime(row.created_at)}</span>
        </div>
      ),
    },
    {
      key: 'party',
      header: 'Account',
      width: COLUMN_WIDTHS[1] ?? '',
      render: (row) => (
        <div className="flex items-center gap-2">
          {/*
            The party badge is not decoration. Once customer wallet rows join this feed, the same
            table will hold two ledgers written from opposite sides, and which one a row came from
            is what makes its amount readable.
          */}
          <Badge tone="neutral" className="whitespace-nowrap">
            {row.party.kind === 'DRIVER' ? 'Driver' : 'Customer'}
          </Badge>
          <span className="truncate">
            {row.party.name ?? <span className="text-text-subtle">Unnamed</span>}
          </span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: COLUMN_WIDTHS[2] ?? '',
      render: (row) => <span className="whitespace-nowrap font-medium">{row.type_label}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[3] ?? '',
      render: (row) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {row.amount.amount_display}
        </span>
      ),
    },
    {
      key: 'direction',
      header: 'Direction',
      width: COLUMN_WIDTHS[4] ?? '',
      /*
       * The column that stops this table lying. The driver ledger and the customer wallet write
       * their signs from opposite sides, so the amount alone cannot say which way money went —
       * `IN` is toward the company, `OUT` is away from it, resolved server-side for both.
       */
      render: (row) =>
        row.direction === 'IN' ? (
          <span className="flex items-center gap-1 whitespace-nowrap text-success">
            <ArrowDownLeft aria-hidden className="size-3.5" />
            In
          </span>
        ) : row.direction === 'OUT' ? (
          <span className="flex items-center gap-1 whitespace-nowrap text-danger">
            <ArrowUpRight aria-hidden className="size-3.5" />
            Out
          </span>
        ) : (
          <span className="text-text-subtle">—</span>
        ),
    },
    {
      key: 'note',
      header: 'Note',
      width: COLUMN_WIDTHS[5] ?? '',
      render: (row) =>
        row.note === null ? (
          <span className="text-text-subtle">—</span>
        ) : (
          <span className="block truncate" title={row.note}>
            {row.note}
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="In to the company"
          icon={<ArrowDownLeft aria-hidden className="size-4" />}
          loading={feed.isLoading}
          tone="success"
          value={formatPaise(data?.summary.debited_paise ?? 0)}
          hint={filtered ? 'Matching the filter' : 'All time'}
        />
        <StatTile
          label="Out to drivers"
          icon={<ArrowUpRight aria-hidden className="size-4" />}
          loading={feed.isLoading}
          tone="danger"
          value={formatPaise(data?.summary.credited_paise ?? 0)}
          hint={filtered ? 'Matching the filter' : 'All time'}
        />
        <StatTile
          label="Net position"
          icon={<Scale aria-hidden className="size-4" />}
          loading={feed.isLoading}
          /*
           * `net` is credited − debited, i.e. from the DRIVER's side: negative means drivers owe
           * the company overall. Flipped here so the label reads from the company's side, which
           * is whose screen this is.
           */
          tone={(data?.summary.net_paise ?? 0) <= 0 ? 'success' : 'danger'}
          value={formatPaise(Math.abs(data?.summary.net_paise ?? 0))}
          hint={(data?.summary.net_paise ?? 0) <= 0 ? 'Owed to the company' : 'Owed to drivers'}
        />
        <StatTile
          label="Movements"
          icon={<Hash aria-hidden className="size-4" />}
          loading={feed.isLoading}
          value={String(data?.summary.count ?? 0)}
          hint={filtered ? 'Matching the filter' : 'All time'}
        />
      </div>

      <FilterBar className="print:hidden">
        <FilterField label="Search" className="min-w-64 flex-1">
          <SearchInput value={typed} onChange={setTyped} placeholder="Search by driver name or mobile" />
        </FilterField>
        <FilterField label="Type">
          <Select
            value={type}
            onValueChange={(value) =>
              params.set({ type: value === 'ALL' ? undefined : value, tpage: undefined })
            }
            options={[
              { value: 'ALL', label: 'All types' },
              ...TRANSACTION_TYPES.map((value) => ({
                value,
                label: TRANSACTION_TYPE_LABELS[value],
              })),
            ]}
          />
        </FilterField>
        <FilterField label="From">
          <Input
            type="date"
            value={from}
            max={to === '' ? undefined : to}
            onChange={(e) => params.set({ from: e.target.value, tpage: undefined })}
          />
        </FilterField>
        <FilterField label="To">
          <Input
            type="date"
            value={to}
            min={from === '' ? undefined : from}
            onChange={(e) => params.set({ to: e.target.value, tpage: undefined })}
          />
        </FilterField>
        <FilterField label="&nbsp;">
          <Button
            variant="ghost"
            disabled={!filtered}
            onClick={() => {
              setTyped('');
              params.set({ tq: undefined, type: undefined, from: undefined, to: undefined, tpage: undefined });
            }}
          >
            <RotateCcw aria-hidden className="size-4" />
            Reset
          </Button>
        </FilterField>
      </FilterBar>

      <section className="overflow-hidden rounded-md border border-border bg-surface print:overflow-visible print:rounded-none print:border-0">
        <ExportBar
          title="Transactions"
          filterSummary={filterSummary}
          sheet={() => transactionsSheet(rows)}
          count={rows.length}
          total={data?.pagination.total_items ?? 0}
          page={page}
          pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
          slug="finance-transactions"
          noun="movements"
        />

        <div className="print:hidden">
          <TopProgressBar active={feed.isFetching && !feed.isLoading} />
        </div>

        <DataState
          loading={feed.isLoading}
          error={feed.isError ? toErrorState(feed.error, () => void feed.refetch()) : undefined}
          empty={rows.length === 0}
          emptyState={{
            icon: <Receipt aria-hidden className="size-6" />,
            title: filtered ? 'No movements match those filters' : 'No money has moved yet',
            description: filtered
              ? 'Try a wider date range, a different type, or clear the search.'
              : 'Entries appear here as drivers complete trips and collect cash.',
          }}
          skeleton={<SkeletonTable rows={10} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            refetching={feed.isFetching && !feed.isLoading}
          />
          <div className="print:hidden">
            <Pagination
              page={page}
              pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
              total={data?.pagination.total_items ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => params.set({ tpage: next === 1 ? undefined : String(next) })}
            />
          </div>
        </DataState>
      </section>
    </div>
  );
}
