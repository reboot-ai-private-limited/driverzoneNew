'use client';

import { useEffect, useMemo, useState } from 'react';
import { UserCog } from 'lucide-react';
import {
  Badge,
  Button,
  CellStack,
  DataState,
  DataTable,
  FilterBar,
  FilterField,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SkeletonTable,
  TopProgressBar,
  type Column,
  type SortState,
} from '@driverzone/design-system';
import type {
  AdminCustomerListItemDto,
  AdminCustomerSort,
  ListCustomersQuery,
} from '@/lib/api/endpoints/customers';
import { ApiError } from '@/lib/api/ApiError';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatMobile } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useCustomers } from '../hooks/useCustomers';
import { CustomerEditDialog } from './CustomerEditDialog';
import { CustomerViewDialog } from './CustomerViewDialog';

const PAGE_SIZE = 15;

/** The skeleton uses the SAME widths as the columns, so nothing shifts when the data lands. */
const COLUMN_WIDTHS = ['w-12', 'w-56', 'w-36', 'w-28', 'w-32', 'w-64', 'w-28', 'w-20', 'w-28'];

type FilterKey = 'q' | 'status' | 'page' | 'sort' | 'dir';

const SORTABLE: Record<string, AdminCustomerSort> = {
  name: 'name',
  mobile: 'mobile',
  joined: 'joined',
};

export function CustomersScreen() {
  const params = useFilterParams<FilterKey>();

  /**
   * The search box holds two values: what the admin has typed, which must appear instantly, and
   * what the list is filtered by, which lags by `SEARCH_DEBOUNCE_MS`. Driving the input straight
   * off the URL would make it lag too, and a text field that echoes a quarter-second late feels
   * broken however correct it is.
   */
  const [typed, setTyped] = useState(() => params.get('q'));
  const search = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    // The guard stops this looping: writing the URL re-renders, which re-runs the effect, which
    // now finds nothing to do.
    if (search !== params.get('q')) params.set({ q: search, page: undefined });
  }, [search, params]);

  const status = params.get('status') || 'ALL';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const sortKey = SORTABLE[params.get('sort')] ?? 'joined';
  // Newest first is the useful default for a directory sorted by join date. An explicit `dir` in
  // the URL always wins, so a shared link shows what the sender was looking at.
  const sortDir = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const sort = useMemo<SortState>(() => ({ key: sortKey, direction: sortDir }), [sortKey, sortDir]);

  /**
   * Memoised because it is a QUERY KEY. A fresh object every render is a fresh key every render,
   * which is a refetch every render.
   */
  const query = useMemo<ListCustomersQuery>(
    () => ({
      ...(search.trim() === '' ? {} : { q: search.trim() }),
      ...(status === 'ALL' ? {} : { is_blocked: status === 'BLOCKED' }),
      page,
      page_size: PAGE_SIZE,
      sort: sortKey,
      dir: sortDir,
    }),
    [search, status, page, sortKey, sortDir],
  );

  const customers = useCustomers(query);

  /** `undefined` means no dialog. Two ids, because View can hand off to Edit. */
  const [viewing, setViewing] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<string | undefined>(undefined);

  const rows = customers.data?.customers ?? [];
  const total = customers.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /**
   * The serial number is the row's position in THIS view, computed from the page offset.
   *
   * It is deliberately not an id and not a stable per-customer number: it exists so an admin can
   * say "the fourth one down", and it is correct only for the sort and page currently on screen.
   */
  const firstSerial = (page - 1) * PAGE_SIZE + 1;

  const columns: Column<AdminCustomerListItemDto>[] = [
    {
      key: 'sl',
      header: 'Sl',
      width: COLUMN_WIDTHS[0] ?? '',
      align: 'right',
      numeric: true,
      render: (customer) => firstSerial + rows.indexOf(customer),
    },
    {
      key: 'name',
      header: 'Customer',
      width: COLUMN_WIDTHS[1] ?? '',
      sortable: true,
      render: (customer) => (
        <CellStack
          primary={customer.full_name ?? <span className="text-text-subtle">Unnamed</span>}
          secondary={customer.is_blocked ? <Badge tone="danger">Blocked</Badge> : undefined}
        />
      ),
    },
    {
      key: 'mobile',
      header: 'Mobile',
      width: COLUMN_WIDTHS[2] ?? '',
      numeric: true,
      sortable: true,
      render: (customer) => formatMobile(customer.mobile_number),
    },
    {
      key: 'joined',
      header: 'Joined',
      width: COLUMN_WIDTHS[3] ?? '',
      numeric: true,
      sortable: true,
      render: (customer) => formatDate(customer.joined_at),
    },
    {
      key: 'car',
      header: 'Car number',
      width: COLUMN_WIDTHS[4] ?? '',
      numeric: true,
      render: (customer) =>
        customer.car_number === null ? (
          <Dash />
        ) : (
          <CellStack
            numeric
            primary={customer.car_number}
            secondary={
              customer.other_vehicle_count > 0 ? `+${customer.other_vehicle_count} more` : undefined
            }
          />
        ),
    },
    {
      key: 'location',
      header: 'Location',
      width: COLUMN_WIDTHS[5] ?? '',
      render: (customer) =>
        customer.location === null ? (
          <Dash />
        ) : (
          // Truncated, with the full text on hover. A saved address is a free-text line that can
          // run to 200 characters, and one of them would otherwise set the height of every row.
          <span className="block truncate" title={customer.location}>
            {customer.location}
          </span>
        ),
    },
    {
      key: 'lastRide',
      header: 'Last ride',
      width: COLUMN_WIDTHS[6] ?? '',
      numeric: true,
      render: (customer) =>
        customer.last_ride_at === null ? <NotYetTracked /> : formatDate(customer.last_ride_at),
    },
    {
      key: 'rating',
      header: 'Rating',
      width: COLUMN_WIDTHS[7] ?? '',
      align: 'right',
      numeric: true,
      render: (customer) =>
        customer.rating === null ? <NotYetTracked /> : customer.rating.toFixed(1),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: COLUMN_WIDTHS[8] ?? '',
      align: 'right',
      // `stopPropagation` on both: the row itself opens the view dialog, so without it an Edit
      // click opens the editor AND the viewer, and the two fight over the focus trap.
      render: (customer) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setViewing(customer.id);
            }}
          >
            View
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(customer.id);
            }}
          >
            Edit
          </Button>
        </div>
      ),
    },
  ];

  const filtered = search.trim() !== '' || status !== 'ALL';

  /**
   * The one failure that is not a fault: `GET /admin/customers` does not exist in `apps/api`
   * yet, so the router falls through to the 404 handler.
   *
   * Routed to the empty state rather than the error state ON PURPOSE. `toErrorState` would
   * render "Not found" over the server's `No route matches GET /api/admin/customers?...`, which
   * is accurate and reads to anyone who is not holding the API source as a broken screen. This
   * says which piece is missing instead.
   *
   * DELETE THIS BRANCH the day the endpoint lands. From then on a 404 here means a customer id
   * that does not resolve, which IS a fault and must not be swallowed as "nothing to show".
   */
  const awaitingApi = customers.error instanceof ApiError && customers.error.code === 'NOT_FOUND';

  return (
    <>
      <PageHeader
        title="Customers"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Customers' }]}
      />

      <FilterBar>
        <FilterField label="Search" className="flex-1 min-w-64">
          <SearchInput
            value={typed}
            onChange={setTyped}
            placeholder="Search by name, mobile or car number"
          />
        </FilterField>
        <FilterField label="Status">
          <Select
            value={status}
            onValueChange={(value) => {
              // A filter change resets the page. Page 4 of the old result set is usually past the
              // end of the new one, and an empty table reads as "no customers" rather than "you
              // are past the end".
              params.set({ status: value === 'ALL' ? undefined : value, page: undefined });
            }}
            options={[
              { value: 'ALL', label: 'All customers' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'BLOCKED', label: 'Blocked' },
            ]}
          />
        </FilterField>
      </FilterBar>

      <section className="bg-surface border border-border rounded-md overflow-hidden">
        {/* A background refetch dims the rows and shows this. It never replaces them with
            skeletons — the row an admin is reading must not vanish. */}
        <TopProgressBar active={customers.isFetching && !customers.isLoading} />

        <DataState
          loading={customers.isLoading}
          error={
            customers.isError && !awaitingApi
              ? toErrorState(customers.error, () => void customers.refetch())
              : undefined
          }
          empty={awaitingApi || rows.length === 0}
          emptyState={{
            icon: <UserCog aria-hidden className="size-6" />,
            title: awaitingApi
              ? 'Customer directory is not available yet'
              : filtered
                ? 'No customers match those filters'
                : 'No customers yet',
            description: awaitingApi
              ? 'This screen is built and waiting on its API. GET /admin/customers does not exist in apps/api yet — the customer records themselves are only reachable by the customer who owns them.'
              : filtered
                ? 'Try a different search, or clear the status filter.'
                : 'A customer record is created the first time somebody signs in with their phone number.',
          }}
          skeleton={<SkeletonTable rows={10} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(customer) => customer.id}
            sort={sort}
            onSortChange={(next) =>
              params.set({ sort: next.key, dir: next.direction, page: undefined })
            }
            // Opening the row opens the read-only view. Edit stays an explicit button: a click
            // that lands on a form is how a record gets changed by someone who meant to read it.
            onRowClick={(customer) => setViewing(customer.id)}
            refetching={customers.isFetching && !customers.isLoading}
          />
          <Pagination
            page={page}
            pageCount={pageCount}
            total={total}
            pageSize={PAGE_SIZE}
            onPageChange={(next) => params.set({ page: next === 1 ? undefined : String(next) })}
          />
        </DataState>
      </section>

      <CustomerViewDialog
        customerId={viewing}
        onClose={() => setViewing(undefined)}
        onEdit={(id) => {
          // One at a time — two open dialogs would trap focus in the one underneath.
          setViewing(undefined);
          setEditing(id);
        }}
      />
      <CustomerEditDialog customerId={editing} onClose={() => setEditing(undefined)} />
    </>
  );
}

/** A field the customer has not filled in. Profiles complete progressively; this is normal. */
function Dash() {
  return <span className="text-text-subtle">—</span>;
}

/**
 * Distinct from `Dash` on purpose. An empty "Last ride" means the bookings module does not exist
 * yet (tier 6, docs/LLD/roadmap.md), not that this customer has never ridden — and an admin
 * should not read the second from the first.
 */
function NotYetTracked() {
  return (
    <span className="text-text-subtle" title="Available once bookings ship">
      —
    </span>
  );
}
