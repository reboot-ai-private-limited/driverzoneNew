'use client';

import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, IndianRupee, Scale, TrendingDown, Wallet } from 'lucide-react';
import {
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
  type LedgerEntryDto,
  type LedgerQueryParams,
  type TransactionType,
} from '@driverzone/contracts';
import {
  Badge,
  DataState,
  DataTable,
  FilterBar,
  FilterField,
  Input,
  Pagination,
  Panel,
  Select,
  SkeletonTable,
  StatTile,
  TopProgressBar,
  type Column,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatPaise, formatTime } from '@/lib/format';
import { useDriverWallet } from '../hooks/useDriverDetails';

const COLUMN_WIDTHS = ['w-32', 'w-48', 'w-64', 'w-32', 'w-32'];
const PAGE_SIZE = 15;


export function DriverWalletTab({ driverId }: { driverId: string }) {
  /*
   * Local state, not the URL, unlike every list screen in the panel. This tab is one of three
   * inside a driver's detail page, and `DriverDetailsScreen` already keeps the active tab in
   * `useState` — putting only this tab's filters in the URL would make a link restore the
   * filters but not the tab they belong to, which is worse than restoring neither.
   */
  const [type, setType] = useState<TransactionType | 'ALL'>('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  /** Memoised because it is a QUERY KEY — a fresh object every render is a refetch every render. */
  const query = useMemo<LedgerQueryParams>(
    () => ({
      ...(type === 'ALL' ? {} : { type }),
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      page,
      limit: PAGE_SIZE,
    }),
    [type, from, to, page],
  );

  const wallet = useDriverWallet(driverId, query);

  const columns: Column<LedgerEntryDto>[] = [
    {
      key: 'date',
      header: 'Date & Time',
      width: COLUMN_WIDTHS[0] ?? '',
      render: (entry) => (
        <div className="flex flex-col">
          <span>{formatDate(entry.created_at)}</span>
          <span className="mt-0.5 text-xs text-text-subtle">{formatTime(entry.created_at)}</span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Transaction Type',
      width: COLUMN_WIDTHS[1] ?? '',
      render: (entry) => (
        <span className="font-medium">{TRANSACTION_TYPE_LABELS[entry.type] ?? entry.type}</span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      width: COLUMN_WIDTHS[2] ?? '',
      render: (entry) => (
        <div className="flex flex-col">
          <span className="text-text">{entry.description}</span>
          {entry.reference_id !== null && (
            <span className="mt-0.5 text-xs tnum text-text-subtle">Ref: {entry.reference_id}</span>
          )}
        </div>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[3] ?? '',
      render: (entry) => {
        const positive = entry.amount_paise > 0;
        const negative = entry.amount_paise < 0;
        return (
          <div
            className={`flex items-center justify-end gap-1 font-medium tnum ${
              positive ? 'text-success' : negative ? 'text-danger' : ''
            }`}
          >
            {positive && <ArrowUpRight aria-hidden className="size-3" />}
            {negative && <ArrowDownRight aria-hidden className="size-3" />}
            {formatPaise(Math.abs(entry.amount_paise))}
          </div>
        );
      },
    },
    {
      key: 'balance',
      header: 'Balance After',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[4] ?? '',
      render: (entry) => (
        <span className="font-medium tnum">{formatPaise(entry.balance_after_paise)}</span>
      ),
    },
  ];

  const data = wallet.data;
  const rows = data?.ledger ?? [];
  const filtered = type !== 'ALL' || from !== '' || to !== '';

  function resetPage<T>(set: (value: T) => void) {
    return (value: T) => {
      set(value);
      // A filter change resets the page: page 3 of the old result set is usually past the end of
      // the new one, and an empty table reads as "no entries" rather than "you are past the end".
      setPage(1);
    };
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
        Balance and lifetime earnings describe the WHOLE account and deliberately ignore the
        filters below — a balance is not a period. The credited/debited/net tiles beside them are
        the opposite: they describe exactly what the filter selected, across every page of it.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Current Balance"
          icon={<Wallet aria-hidden className="size-4" />}
          loading={wallet.isLoading}
          tone={(data?.wallet.balance_paise ?? 0) < 0 ? 'danger' : 'default'}
          value={formatPaise(data?.wallet.balance_paise ?? 0)}
          badge={
            data?.wallet.is_suspended_for_balance === true ? (
              <Badge tone="danger">Suspended</Badge>
            ) : undefined
          }
          hint={
            (data?.wallet.balance_paise ?? 0) < 0 ? 'Owed to the company' : 'Payable to the driver'
          }
        />
        <StatTile
          label="Lifetime Earnings"
          icon={<IndianRupee aria-hidden className="size-4" />}
          loading={wallet.isLoading}
          value={formatPaise(data?.wallet.lifetime_earnings_paise ?? 0)}
        />
        <StatTile
          label="Credited"
          icon={<ArrowUpRight aria-hidden className="size-4" />}
          loading={wallet.isLoading}
          tone="success"
          value={formatPaise(data?.summary.credited_paise ?? 0)}
          hint={filtered ? 'Matching the filter' : 'All time'}
        />
        <StatTile
          label="Debited"
          icon={<TrendingDown aria-hidden className="size-4" />}
          loading={wallet.isLoading}
          tone="danger"
          value={formatPaise(data?.summary.debited_paise ?? 0)}
          hint={
            data === undefined
              ? undefined
              : `Net ${formatPaise(data.summary.net_paise)} over ${data.summary.count} entries`
          }
        />
      </div>

      <FilterBar>
        <FilterField label="Type">
          <Select
            value={type}
            onValueChange={(value) => resetPage(setType)(value as TransactionType | 'ALL')}
            options={[
              { value: 'ALL', label: 'All types' },
              ...TRANSACTION_TYPES.map((value) => ({ value, label: TRANSACTION_TYPE_LABELS[value] })),
            ]}
          />
        </FilterField>
        <FilterField label="From">
          <Input
            type="date"
            value={from}
            max={to === '' ? undefined : to}
            onChange={(e) => resetPage(setFrom)(e.target.value)}
          />
        </FilterField>
        <FilterField label="To">
          <Input
            type="date"
            value={to}
            min={from === '' ? undefined : from}
            onChange={(e) => resetPage(setTo)(e.target.value)}
          />
        </FilterField>
      </FilterBar>

      <Panel title="Ledger History" flush>
        <TopProgressBar active={wallet.isFetching && !wallet.isLoading} />

        <DataState
          loading={wallet.isLoading}
          error={
            wallet.isError ? toErrorState(wallet.error, () => void wallet.refetch()) : undefined
          }
          empty={rows.length === 0}
          emptyState={{
            icon: <Scale aria-hidden className="size-6" />,
            title: filtered ? 'No entries match those filters' : 'No transactions yet',
            description: filtered
              ? 'Try a wider date range, or a different transaction type.'
              : 'Entries appear here as the driver completes trips and collects cash.',
          }}
          skeleton={<SkeletonTable rows={5} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(entry) => entry.id}
            refetching={wallet.isFetching && !wallet.isLoading}
          />
          <Pagination
            page={page}
            pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
            total={data?.pagination.total_items ?? 0}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </DataState>
      </Panel>
    </div>
  );
}
