'use client';

import { useMemo, useState } from 'react';
import { HandCoins, RotateCcw, Wallet } from 'lucide-react';
import {
  Badge,
  Button,
  DataState,
  DataTable,
  FilterBar,
  FilterField,
  Input,
  Pagination,
  Select,
  SkeletonTable,
  StatTile,
  TopProgressBar,
  type Column,
} from '@driverzone/design-system';
import {
  WALLET_ENTRY_LABELS,
  WALLET_ENTRY_TYPES,
  type CustomerWalletQueryParams,
  type WalletEntryDto,
} from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatPaise, formatTime } from '@/lib/format';
import { GrantCreditDialog } from '@/features/finance/components/GrantCreditDialog';
import { useCustomerWallet } from '../hooks/useCustomerWallet';

const PAGE_SIZE = 10;
const COLUMN_WIDTHS = ['w-32', 'w-40', 'w-28', 'w-32', 'w-56'];

/**
 * The wallet, on the customer's own page.
 *
 * THE SAME DATA AS THE FINANCE TAB'S CUSTOMER ROW, one level down: that tab answers "who holds
 * credit", this section answers "why does this person hold it". Both read the balance from the
 * rows rather than the `customers.walletBalancePaise` cache, which is documented as never being
 * the truth and has no writer.
 *
 * FILTER STATE IS LOCAL, not in the URL — the deliberate difference from the Finance tabs. This
 * is one section on a page about a person; putting its paging in the query string would mean a
 * link to a customer restored somebody's wallet filter along with them, and the page has five
 * other panels with no such claim on the URL.
 */
export function CustomerWalletSection({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string | null;
}) {
  const [type, setType] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [granting, setGranting] = useState(false);

  /** Memoised because it is a QUERY KEY — a fresh object every render is a refetch every render. */
  const query = useMemo<CustomerWalletQueryParams>(
    () => ({
      ...(type === 'ALL' ? {} : { type }),
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      page,
      limit: PAGE_SIZE,
    }),
    [type, from, to, page],
  );

  const wallet = useCustomerWallet(customerId, query);
  const data = wallet.data;
  const rows = data?.entries ?? [];
  const filtered = type !== 'ALL' || from !== '' || to !== '';

  const columns: Column<WalletEntryDto>[] = [
    {
      key: 'when',
      header: 'Date',
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
      key: 'type',
      header: 'Type',
      width: COLUMN_WIDTHS[1] ?? '',
      render: (row) => (
        <span className="whitespace-nowrap font-medium">
          {WALLET_ENTRY_LABELS[row.entry_type]}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[2] ?? '',
      /*
       * Coloured by SIGN, which is safe here in a way it is not on the Finance transactions feed:
       * this table holds one customer's rows from one ledger, so positive is unambiguously money
       * toward them. The feed mixes two ledgers written from opposite sides and needs its own
       * `direction` column for exactly that reason.
       */
      render: (row) => (
        <span
          className={`whitespace-nowrap font-semibold tabular-nums ${
            row.amount.amount_paise < 0 ? 'text-danger' : 'text-success'
          }`}
        >
          {row.amount.amount_display}
        </span>
      ),
    },
    {
      key: 'booking',
      header: 'Booking',
      width: COLUMN_WIDTHS[3] ?? '',
      /*
       * The id, not a `DZ-…` reference: `wallet` sits below `bookings` in the module graph and
       * cannot resolve one, so the row has no reference to show. The writer puts the readable
       * code into `note`, which is where the next column looks.
       */
      render: (row) =>
        row.booking_id === null ? (
          <span className="text-text-subtle">—</span>
        ) : (
          <span className="truncate font-mono text-xs" title={row.booking_id}>
            {row.booking_id.slice(-8)}
          </span>
        ),
    },
    {
      key: 'note',
      header: 'Note',
      width: COLUMN_WIDTHS[4] ?? '',
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
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Wallet aria-hidden className="size-4 text-text-subtle" />
          Wallet
        </h2>
        <Button size="sm" variant="secondary" className="print:hidden" onClick={() => setGranting(true)}>
          <HandCoins aria-hidden className="size-4" />
          Add credit or fine
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Balance"
          loading={wallet.isLoading}
          tone={
            (data?.balance.amount_paise ?? 0) < 0
              ? 'danger'
              : (data?.balance.amount_paise ?? 0) > 0
                ? 'success'
                : 'default'
          }
          value={data?.balance.amount_display ?? '—'}
          hint="Summed from every entry, all time"
        />
        <StatTile
          label="Spendable credit"
          loading={wallet.isLoading}
          value={data?.spendable_credit.amount_display ?? '—'}
          hint="Applies automatically to their next fare"
        />
        <StatTile
          label="Owed to us"
          loading={wallet.isLoading}
          tone={(data?.amount_owed.amount_paise ?? 0) > 0 ? 'danger' : 'default'}
          value={data?.amount_owed.amount_display ?? '—'}
          hint="Unpaid fees carried forward"
        />
      </div>

      <FilterBar className="print:hidden">
        <FilterField label="Type">
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value);
              setPage(1);
            }}
            options={[
              { value: 'ALL', label: 'All types' },
              ...WALLET_ENTRY_TYPES.map((value) => ({
                value,
                label: WALLET_ENTRY_LABELS[value],
              })),
            ]}
          />
        </FilterField>
        <FilterField label="From">
          <Input
            type="date"
            value={from}
            max={to === '' ? undefined : to}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </FilterField>
        <FilterField label="To">
          <Input
            type="date"
            value={to}
            min={from === '' ? undefined : from}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </FilterField>
        <FilterField label="&nbsp;">
          <Button
            variant="ghost"
            disabled={!filtered}
            onClick={() => {
              setType('ALL');
              setFrom('');
              setTo('');
              setPage(1);
            }}
          >
            <RotateCcw aria-hidden className="size-4" />
            Reset
          </Button>
        </FilterField>
      </FilterBar>

      {/*
        The totals row describes the FILTERED selection, unlike the balance tiles above it which
        are always all-time. Said out loud in the badge, because a "credited" figure that moves
        when a date changes sitting beside a balance that does not is otherwise a contradiction.
      */}
      {data !== undefined && data.summary.count > 0 && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-surface-sunken px-4 py-2.5 text-sm">
          <Badge tone="neutral">{filtered ? 'Filtered' : 'All entries'}</Badge>
          <span className="text-text-subtle">
            Credited <span className="font-medium text-success">{formatPaise(data.summary.credited_paise)}</span>
          </span>
          <span className="text-text-subtle">
            Debited <span className="font-medium text-danger">{formatPaise(data.summary.debited_paise)}</span>
          </span>
          <span className="text-text-subtle">
            Net <span className="font-medium text-text">{formatPaise(data.summary.net_paise)}</span>
          </span>
          <span className="text-text-subtle">
            {data.summary.count} {data.summary.count === 1 ? 'entry' : 'entries'}
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-border">
        <TopProgressBar active={wallet.isFetching && !wallet.isLoading} />

        <DataState
          loading={wallet.isLoading}
          error={wallet.isError ? toErrorState(wallet.error, () => void wallet.refetch()) : undefined}
          empty={rows.length === 0}
          emptyState={{
            icon: <Wallet aria-hidden className="size-6" />,
            title: filtered ? 'No entries match those filters' : 'This wallet has no entries',
            description: filtered
              ? 'Try a wider date range, or a different type.'
              : 'Credit granted, cancellation fees and adjustments all appear here.',
          }}
          skeleton={<SkeletonTable rows={5} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            refetching={wallet.isFetching && !wallet.isLoading}
          />
          {/* Page controls are a screen affordance; on paper they are a row of dead buttons. */}
          <div className="print:hidden">
            <Pagination
              page={page}
              pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
              total={data?.pagination.total_items ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          </div>
        </DataState>
      </div>

      <GrantCreditDialog
        customer={
          granting && data !== undefined
            ? { customer_id: customerId, name: customerName, balance: data.balance }
            : undefined
        }
        onClose={() => setGranting(false)}
      />
    </section>
  );
}
