'use client';

import { useEffect, useMemo, useState } from 'react';
import { HandCoins, RotateCcw, Users, Wallet } from 'lucide-react';
import {
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
import type { AdminCustomerWalletsQuery, CustomerWalletRowDto } from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatMobile } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useCustomerWallets } from '../hooks/useCustomerWallets';
import { customerWalletsSheet } from '../lib/export';
import { ExportBar } from './ExportBar';
import { GrantCreditDialog } from './GrantCreditDialog';

const PAGE_SIZE = 20;
const COLUMN_WIDTHS = ['w-56', 'w-32', 'w-32', 'w-32', 'w-32', 'w-24'];

/** Prefixed so this tab's filters cannot collide with the other two in one URL. */
type FilterKey = 'cq' | 'cstate' | 'csort' | 'cpage';

export function CustomerWalletsTab() {
  const params = useFilterParams<FilterKey>();

  const [typed, setTyped] = useState(() => params.get('cq'));
  const search = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    if (search !== params.get('cq')) params.set({ cq: search, cpage: undefined });
  }, [search, params]);

  const state = params.get('cstate') || 'ALL';
  const sort = params.get('csort') || 'BALANCE_DESC';
  const page = Math.max(1, Number(params.get('cpage')) || 1);

  const [granting, setGranting] = useState<CustomerWalletRowDto | undefined>(undefined);

  const query = useMemo<AdminCustomerWalletsQuery>(
    () => ({
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      ...(state === 'ALL' ? {} : { state: state as AdminCustomerWalletsQuery['state'] }),
      sort: sort as AdminCustomerWalletsQuery['sort'],
      page,
      limit: PAGE_SIZE,
    }),
    [search, state, sort, page],
  );

  const wallets = useCustomerWallets(query);
  const data = wallets.data;
  const rows = data?.rows ?? [];
  const filtered = search.trim() !== '' || state !== 'ALL';

  const STATE_LABELS: Record<string, string> = {
    IN_CREDIT: 'Holding credit',
    IN_DEBT: 'Owes us',
    SETTLED: 'Settled (zero)',
  };
  const filterSummary = [
    search.trim() === '' ? null : `Search: "${search.trim()}"`,
    state === 'ALL' ? null : `Balance: ${STATE_LABELS[state] ?? state}`,
  ].filter((line): line is string => line !== null);

  const columns: Column<CustomerWalletRowDto>[] = [
    {
      key: 'customer',
      header: 'Customer',
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
      key: 'credit',
      header: 'Spendable credit',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[1] ?? '',
      render: (row) =>
        row.spendable_credit.amount_paise === 0 ? (
          <span className="text-text-subtle">—</span>
        ) : (
          <span className="whitespace-nowrap font-semibold text-success">
            {row.spendable_credit.amount_display}
          </span>
        ),
    },
    {
      key: 'owed',
      header: 'Owes us',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[2] ?? '',
      render: (row) =>
        row.amount_owed.amount_paise === 0 ? (
          <span className="text-text-subtle">—</span>
        ) : (
          <span className="whitespace-nowrap font-semibold text-danger">
            {row.amount_owed.amount_display}
          </span>
        ),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      numeric: true,
      width: COLUMN_WIDTHS[3] ?? '',
      render: (row) => (
        <span className="whitespace-nowrap tabular-nums">{row.balance.amount_display}</span>
      ),
    },
    {
      key: 'activity',
      header: 'Last entry',
      numeric: true,
      width: COLUMN_WIDTHS[4] ?? '',
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
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: COLUMN_WIDTHS[5] ?? '',
      render: (row) => (
        <div className="print:hidden">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setGranting(row);
            }}
          >
            Adjust
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Credit outstanding"
          icon={<Wallet aria-hidden className="size-4" />}
          loading={wallets.isLoading}
          tone="warning"
          value={data?.totals.total_credit_outstanding.amount_display ?? '—'}
          /* Granted and not yet spent — a liability, not an asset. */
          hint={
            data === undefined
              ? undefined
              : `The company owes ${data.totals.customers_in_credit} ${data.totals.customers_in_credit === 1 ? 'customer' : 'customers'}`
          }
        />
        <StatTile
          label="Owed by customers"
          icon={<HandCoins aria-hidden className="size-4" />}
          loading={wallets.isLoading}
          tone="danger"
          value={data?.totals.total_owed_by_customers.amount_display ?? '—'}
          hint={
            data === undefined
              ? undefined
              : `${data.totals.customers_in_debt} ${data.totals.customers_in_debt === 1 ? 'customer has' : 'customers have'} an unpaid fee`
          }
        />
        <StatTile
          label="Customers with activity"
          icon={<Users aria-hidden className="size-4" />}
          loading={wallets.isLoading}
          value={String(data?.totals.customers ?? 0)}
          hint={filtered ? 'Matching the filter' : 'All time'}
        />
        <StatTile
          label="Net position"
          icon={<Wallet aria-hidden className="size-4" />}
          loading={wallets.isLoading}
          value={
            data === undefined
              ? '—'
              : `₹${Math.abs(
                  (data.totals.total_credit_outstanding.amount_paise -
                    data.totals.total_owed_by_customers.amount_paise) /
                    100,
                ).toLocaleString('en-IN')}`
          }
          hint={
            data === undefined
              ? undefined
              : data.totals.total_credit_outstanding.amount_paise >=
                  data.totals.total_owed_by_customers.amount_paise
                ? 'Net owed to customers'
                : 'Net owed by customers'
          }
        />
      </div>

      <FilterBar className="print:hidden">
        <FilterField label="Search" className="min-w-64 flex-1">
          <SearchInput
            value={typed}
            onChange={setTyped}
            placeholder="Search by customer name or mobile"
          />
        </FilterField>
        <FilterField label="Balance">
          <Select
            value={state}
            onValueChange={(value) =>
              params.set({ cstate: value === 'ALL' ? undefined : value, cpage: undefined })
            }
            options={[
              { value: 'ALL', label: 'All customers' },
              { value: 'IN_CREDIT', label: 'Holding credit' },
              { value: 'IN_DEBT', label: 'Owes us' },
              { value: 'SETTLED', label: 'Settled (zero)' },
            ]}
          />
        </FilterField>
        <FilterField label="Sort">
          <Select
            value={sort}
            onValueChange={(value) =>
              params.set({ csort: value === 'BALANCE_DESC' ? undefined : value, cpage: undefined })
            }
            options={[
              { value: 'BALANCE_DESC', label: 'Most credit first' },
              { value: 'BALANCE_ASC', label: 'Most owed first' },
              { value: 'LAST_ACTIVITY_DESC', label: 'Most recent activity' },
            ]}
          />
        </FilterField>
        <FilterField label="&nbsp;">
          <Button
            variant="ghost"
            disabled={!filtered && sort === 'BALANCE_DESC'}
            onClick={() => {
              setTyped('');
              params.set({ cq: undefined, cstate: undefined, csort: undefined, cpage: undefined });
            }}
          >
            <RotateCcw aria-hidden className="size-4" />
            Reset
          </Button>
        </FilterField>
      </FilterBar>

      <section className="overflow-hidden rounded-md border border-border bg-surface print:overflow-visible print:rounded-none print:border-0">
        <ExportBar
          title="Customer wallets"
          filterSummary={filterSummary}
          sheet={() => customerWalletsSheet(rows)}
          count={rows.length}
          total={data?.pagination.total_items ?? 0}
          page={page}
          pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
          slug="customer-wallets"
          noun="customers"
        />

        <div className="print:hidden">
          <TopProgressBar active={wallets.isFetching && !wallets.isLoading} />
        </div>

        <DataState
          loading={wallets.isLoading}
          error={
            wallets.isError ? toErrorState(wallets.error, () => void wallets.refetch()) : undefined
          }
          empty={rows.length === 0}
          emptyState={{
            icon: <Wallet aria-hidden className="size-6" />,
            title: filtered ? 'No customers match those filters' : 'No customer wallet activity',
            /*
             * "With activity", like the driver list. A customer who has never been granted credit
             * or charged a fee has no wallet rows and is legitimately absent — the full roster is
             * the Customers screen.
             */
            description: filtered
              ? 'Try a different balance state, or clear the search.'
              : 'A customer appears here once credit is granted or a fee is charged. The full roster is on the Customers screen.',
          }}
          skeleton={<SkeletonTable rows={8} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.customer_id}
            refetching={wallets.isFetching && !wallets.isLoading}
          />
          <div className="print:hidden">
            <Pagination
              page={page}
              pageCount={Math.max(1, data?.pagination.total_pages ?? 1)}
              total={data?.pagination.total_items ?? 0}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => params.set({ cpage: next === 1 ? undefined : String(next) })}
            />
          </div>
        </DataState>
      </section>

      <GrantCreditDialog customer={granting} onClose={() => setGranting(undefined)} />
    </div>
  );
}
