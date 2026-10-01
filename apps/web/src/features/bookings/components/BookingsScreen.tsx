'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  Columns3,
  Eye,
  FileSpreadsheet,
  Plus,
  Printer,
  RotateCcw,
} from 'lucide-react';
import {
  Badge,
  Button,
  CellStack,
  DataState,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  FilterBar,
  FilterField,
  Input,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SkeletonTable,
  toast,
  TopProgressBar,
  type Column,
} from '@driverzone/design-system';
import type { AdminListBookingsQuery, BookingDto } from '@driverzone/contracts';
import { statusParam } from '@/lib/api/endpoints/bookings';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatTime } from '@/lib/format';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { BOOKING_SEARCH_DEBOUNCE_MS } from '@/lib/hooks/timing';
import { useBookings } from '../hooks/useBookings';
import { downloadCsv, printCurrentView } from '../lib/export';
import { formatBookingDate, formatBookingMobile } from '../lib/format';
import {
  STATUS_GROUPS,
  STATUS_GROUP_LABELS,
  serviceTypeLabel,
  serviceTypeTone,
  statusLabel,
  statusTone,
  type StatusGroup,
} from '../lib/status';

const PAGE_SIZE = 10;

/**
 * The skeleton uses the SAME widths as the columns, so nothing shifts when the data lands.
 *
 * Pickup and destination (indices 7-8) are `w-64`, not `w-44` — they now wrap the FULL address
 * instead of truncating it, so the column needs enough room that an ordinary address wraps to
 * two lines rather than six.
 */
const COLUMN_WIDTHS = [
  'w-12',
  'w-32',
  'w-28',
  'w-36',
  'w-32',
  'w-36',
  'w-32',
  'w-64',
  'w-64',
  'w-28',
  'w-32',
  'w-24',
  'w-16',
];

/**
 * The columns an admin can switch off, and the ones they cannot.
 *
 * Twelve columns do not fit a laptop without the table scrolling sideways, and which of them
 * matter depends on the job: dispatch wants the addresses, accounts wants the fare, support wants
 * the mobiles. Rather than choose for them, the optional ones toggle. Booking id, status and
 * actions are not in here — a row you cannot identify, judge or act on is not a row.
 */
const OPTIONAL_COLUMNS = {
  customerMobile: 'Customer mobile',
  driverMobile: 'Driver mobile',
  pickup: 'Pickup',
  destination: 'Destination',
  tripType: 'Trip type',
  fare: 'Fare',
} as const;

type OptionalColumn = keyof typeof OPTIONAL_COLUMNS;

type FilterKey = 'q' | 'status' | 'from' | 'to' | 'page';

export function BookingsScreen() {
  const params = useFilterParams<FilterKey>();
  const router = useRouter();

  /**
   * The search box holds two values: what the admin has typed, which must appear instantly, and
   * what the list is filtered by, which lags by `BOOKING_SEARCH_DEBOUNCE_MS`. Driving the input
   * straight off the URL would make it lag too — the same reasoning `CustomersScreen` records
   * for its own (shorter) debounce.
   */
  const [typed, setTyped] = useState(() => params.get('q'));
  const search = useDebouncedValue(typed, BOOKING_SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    // The guard stops this looping: writing the URL re-renders, which re-runs the effect, which
    // now finds nothing to do.
    if (search !== params.get('q')) params.set({ q: search, page: undefined });
  }, [search, params]);

  const group = (params.get('status') || 'ALL') as StatusGroup | 'ALL';
  const from = params.get('from');
  const to = params.get('to');
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [hidden, setHidden] = useState<ReadonlySet<OptionalColumn>>(() => new Set());

  /**
   * Memoised because it is a QUERY KEY. A fresh object every render is a fresh key every render,
   * which is a refetch every render.
   */
  const query = useMemo<AdminListBookingsQuery>(
    () => ({
      ...(search.trim() === '' ? {} : { search: search.trim() }),
      ...(group === 'ALL' ? {} : { status: statusParam(STATUS_GROUPS[group]) }),
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      page,
      limit: PAGE_SIZE,
    }),
    [search, group, from, to, page],
  );

  const bookings = useBookings(query);

  const rows = bookings.data?.bookings ?? [];
  // Straight from the server's envelope rather than recomputed here: the API clamps `limit`, so a
  // page count derived from the client's PAGE_SIZE can disagree with the pages that exist.
  const total = bookings.data?.pagination.total_items ?? 0;
  const pageCount = Math.max(1, bookings.data?.pagination.total_pages ?? 1);

  /**
   * The serial number is the row's position in THIS view, computed from the page offset. It is
   * deliberately not an id: it exists so an admin can say "the fourth one down".
   */
  const firstSerial = (page - 1) * PAGE_SIZE + 1;

  const filtered = search.trim() !== '' || group !== 'ALL' || from !== '' || to !== '';

  function resetFilters() {
    setTyped('');
    params.set({
      q: undefined,
      status: undefined,
      from: undefined,
      to: undefined,
      page: undefined,
    });
  }

  function exportExcel() {
    if (rows.length === 0) return;
    downloadCsv(rows, `bookings-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`);
    // Says the page, not the filter. What left the building was ten rows, and an admin who
    // believes they exported 128 will reconcile against the wrong number for an hour.
    toast.success(`Exported ${rows.length} bookings from page ${page}`);
  }

  const allColumns: Array<Column<BookingDto> & { optional?: OptionalColumn }> = [
    {
      key: 'sl',
      header: 'Sl',
      width: COLUMN_WIDTHS[0] ?? '',
      align: 'right',
      numeric: true,
      render: (booking) => firstSerial + rows.indexOf(booking),
    },
    {
      key: 'reference',
      header: 'Booking ID',
      width: COLUMN_WIDTHS[1] ?? '',
      render: (booking) => (
        <span className="whitespace-nowrap font-medium tabular-nums">{booking.reference}</span>
      ),
    },
    {
      key: 'when',
      header: 'Date & time',
      width: COLUMN_WIDTHS[2] ?? '',
      numeric: true,
      render: (booking) => (
        <CellStack
          numeric
          primary={formatBookingDate(booking.scheduled_at)}
          secondary={formatTime(booking.scheduled_at)}
        />
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      width: COLUMN_WIDTHS[3] ?? '',
      render: (booking) => (
        <PersonName name={booking.customer?.name ?? null} resolved={booking.customer !== null} />
      ),
    },
    {
      key: 'customerMobile',
      optional: 'customerMobile',
      header: 'Customer mobile',
      width: COLUMN_WIDTHS[4] ?? '',
      numeric: true,
      render: (booking) => <Mobile phone={booking.customer?.phone ?? null} />,
    },
    {
      key: 'driver',
      header: 'Driver',
      width: COLUMN_WIDTHS[5] ?? '',
      render: (booking) =>
        booking.driver === null ? (
          <Unassigned />
        ) : (
          <PersonName name={booking.driver.name} resolved />
        ),
    },
    {
      key: 'driverMobile',
      optional: 'driverMobile',
      header: 'Driver mobile',
      width: COLUMN_WIDTHS[6] ?? '',
      numeric: true,
      render: (booking) => <Mobile phone={booking.driver?.phone ?? null} />,
    },
    {
      key: 'pickup',
      optional: 'pickup',
      header: 'Pickup',
      width: COLUMN_WIDTHS[7] ?? '',
      render: (booking) => <Address text={booking.pickup.address} />,
    },
    {
      key: 'destination',
      optional: 'destination',
      header: 'Destination',
      width: COLUMN_WIDTHS[8] ?? '',
      render: (booking) => <Address text={booking.drop.address} />,
    },
    {
      key: 'tripType',
      optional: 'tripType',
      header: 'Trip type',
      width: COLUMN_WIDTHS[9] ?? '',
      render: (booking) => (
        <Badge tone={serviceTypeTone(booking.service_type)} className="whitespace-nowrap">
          {serviceTypeLabel(booking.service_type)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: COLUMN_WIDTHS[10] ?? '',
      render: (booking) => (
        <Badge tone={statusTone(booking.status)}>{statusLabel(booking.status)}</Badge>
      ),
    },
    {
      key: 'fare',
      optional: 'fare',
      // 'Total', not 'Fare': the figure includes an extra day and a waiting charge when there
      // was one. The column KEY stays 'fare' — it is the saved show/hide preference, and renaming
      // it would silently re-show a column an admin had hidden.
      header: 'Total',
      width: COLUMN_WIDTHS[11] ?? '',
      align: 'right',
      numeric: true,
      render: (booking) => booking.payable.total.amount_display,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: COLUMN_WIDTHS[12] ?? '',
      align: 'right',
      render: (booking) => (
        <div className="flex items-center justify-end gap-1 print:hidden">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`View booking ${booking.reference}`}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/bookings/${booking.id}`);
            }}
          >
            <Eye aria-hidden className="size-4" />
          </Button>
          {/* No Edit button. There is no admin update endpoint, and a control that can never be
              enabled is worse than one that was never drawn. */}
        </div>
      ),
    },
  ];

  const columns = allColumns.filter((c) => c.optional === undefined || !hidden.has(c.optional));

  const filterSummary = [
    search.trim() === '' ? null : `Search: "${search.trim()}"`,
    group === 'ALL' ? null : `Status: ${STATUS_GROUP_LABELS[group]}`,
    from === '' && to === '' ? null : `Date: ${from || 'any'} to ${to || 'any'}`,
  ].filter((line): line is string => line !== null);

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title="Booking Management"
          breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Bookings' }]}
          actions={
            <Button
              size="sm"
              variant="primary"
              icon={<Plus aria-hidden className="size-3.5" />}
              onClick={() => router.push('/bookings/new')}
            >
              New booking
            </Button>
          }
        />
      </div>

      {/*
        PRINT ONLY — `hidden print:block`. A screen already has the filter bar and the page
        header to say what this list is; a sheet of paper someone hands to another person has
        neither, so the report states its own subject, its own filters and the moment it was
        produced instead of assuming the reader was looking at the screen a second ago.
      */}
      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">Booking Management — Bookings Report</h1>
        {filterSummary.length > 0 && (
          <p className="mt-1 text-sm text-text-subtle">Filters — {filterSummary.join(' · ')}</p>
        )}
        <p className="mt-1 text-xs text-text-subtle">
          Showing {rows.length} of {total} bookings (page {page} of {pageCount}) · Generated{' '}
          {formatBookingDate(new Date().toISOString())}, {formatTime(new Date().toISOString())} IST
        </p>
      </div>

      <div className="print:hidden">
      <FilterBar>
        <FilterField label="Search" className="flex-1 min-w-64">
          <SearchInput
            value={typed}
            onChange={setTyped}
            placeholder="Search by booking ID, customer, driver or mobile"
          />
        </FilterField>
        <FilterField label="From">
          <Input
            type="date"
            value={from}
            max={to === '' ? undefined : to}
            onChange={(e) => params.set({ from: e.target.value, page: undefined })}
          />
        </FilterField>
        <FilterField label="To">
          <Input
            type="date"
            value={to}
            min={from === '' ? undefined : from}
            onChange={(e) => params.set({ to: e.target.value, page: undefined })}
          />
        </FilterField>
        <FilterField label="Trip status">
          <Select
            value={group}
            onValueChange={(value) => {
              // A filter change resets the page. Page 4 of the old result set is usually past the
              // end of the new one, and an empty table reads as "no bookings" rather than "you
              // are past the end".
              params.set({ status: value === 'ALL' ? undefined : value, page: undefined });
            }}
            options={[
              { value: 'ALL', label: 'All status' },
              ...Object.keys(STATUS_GROUPS).map((key) => ({
                value: key,
                label: STATUS_GROUP_LABELS[key as StatusGroup],
              })),
            ]}
          />
        </FilterField>
        {/*
          No Apply button, unlike the design this was built from. Every control here writes the
          URL and the table follows, so a button would only add a state in which the screen
          disagrees with the filters shown above it.
        */}
        <FilterField label="&nbsp;">
          <Button variant="ghost" onClick={resetFilters} disabled={!filtered}>
            <RotateCcw aria-hidden className="size-4" />
            Reset
          </Button>
        </FilterField>
      </FilterBar>
      </div>

      {/*
        `print:overflow-visible`: `overflow-hidden` here clips at this box's own edge — it exists
        so the section's rounded corners stay clean on screen, with `DataTable`'s own inner
        scroll wrapper handling anything wider. On print that inner wrapper's `overflow-visible`
        (see `DataTable.tsx`) only stops IT from clipping; without also overriding THIS ancestor,
        whatever the table needed to overflow past was still getting cut here instead — a second
        clip nobody had turned off, which is exactly why columns went missing on paper.
      */}
      <section className="bg-surface border border-border rounded-md overflow-hidden print:overflow-visible print:border-0 print:rounded-none">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 print:hidden">
          <h2 className="text-sm font-semibold">Bookings list</h2>

          <div className="flex items-center gap-2 print:hidden">
            <Button size="sm" variant="ghost" onClick={exportExcel} disabled={rows.length === 0}>
              <FileSpreadsheet aria-hidden className="size-4" />
              Export Excel
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={printCurrentView}
              disabled={rows.length === 0}
            >
              <Printer aria-hidden className="size-4" />
              Print / PDF
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost">
                  <Columns3 aria-hidden className="size-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Show columns</DropdownMenuLabel>
                {/*
                  Plain labels, NOT `DropdownMenuItem`. Radix closes the menu when an Item is
                  selected, and the design system's Item drops the event (`onSelect: () =>
                  onSelect()`), so `preventDefault` cannot reach it — switching four columns off
                  would mean reopening the menu four times. Content that is not an Item does not
                  close it, which is the behaviour a multi-select needs.
                */}
                {(Object.keys(OPTIONAL_COLUMNS) as OptionalColumn[]).map((key) => (
                  <label
                    key={key}
                    className="flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-text hover:bg-surface-muted"
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(key)}
                      onChange={() => {
                        setHidden((current) => {
                          const next = new Set(current);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                      className="size-3.5 accent-accent"
                    />
                    {OPTIONAL_COLUMNS[key]}
                  </label>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* A background refetch dims the rows and shows this. It never replaces them with
            skeletons — the row an admin is reading must not vanish. */}
        <div className="print:hidden">
          <TopProgressBar active={bookings.isFetching && !bookings.isLoading} />
        </div>

        <DataState
          loading={bookings.isLoading}
          error={
            bookings.isError ? toErrorState(bookings.error, () => void bookings.refetch()) : undefined
          }
          empty={rows.length === 0}
          emptyState={{
            icon: <CalendarClock aria-hidden className="size-6" />,
            title: filtered ? 'No bookings match those filters' : 'No bookings yet',
            description: filtered
              ? 'Try a wider date range, a different status, or clear the search.'
              : 'A booking appears here as soon as a customer confirms one in the app.',
          }}
          skeleton={<SkeletonTable rows={PAGE_SIZE} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(booking) => booking.id}
            onRowClick={(booking) => router.push(`/bookings/${booking.id}`)}
            refetching={bookings.isFetching && !bookings.isLoading}
          />
          {/* Page numbers are a screen control — the printed report states its own page and
              count in the header above instead, see `filterSummary`. */}
          <div className="print:hidden">
            <Pagination
              page={page}
              pageCount={pageCount}
              total={total}
              pageSize={PAGE_SIZE}
              onPageChange={(next) => params.set({ page: next === 1 ? undefined : String(next) })}
            />
          </div>
        </DataState>
      </section>
    </>
  );
}

/**
 * A name the server did not resolve is not the same as an account with no name on it, and
 * `BookingDto` is explicit that a null object means "not looked up" — never a placeholder — so a
 * screen can tell the two apart. This is that distinction, rendered.
 */
function PersonName({ name, resolved }: { name: string | null; resolved: boolean }) {
  if (!resolved) {
    return (
      <span className="text-text-subtle" title="Not resolved on this read">
        —
      </span>
    );
  }
  if (name === null) return <span className="text-text-subtle">Unnamed</span>;
  return <>{name}</>;
}

function Unassigned() {
  return (
    <span className="text-text-subtle" title="No driver has taken this booking yet">
      Unassigned
    </span>
  );
}

/**
 * A mobile number, or a dash where the account has none on file.
 *
 * ADMIN READS CARRY THE NUMBER ON EVERY STATUS, not only live trips. The customer and driver apps
 * are gated — neither party keeps the other's number once the trip that justified it is over —
 * but an admin is not a party to the trip, and the panel already renders `mobile_number` on the
 * customer and driver directories. See `revealPhones` in `bookings.mapper.ts` for the decision.
 *
 * So a dash here means the record genuinely has no number, which for a driver row usually means
 * no driver has taken the booking yet.
 */
function Mobile({ phone }: { phone: string | null }) {
  if (phone === null) return <span className="text-text-subtle">—</span>;
  return <span className="whitespace-nowrap tabular-nums">{formatBookingMobile(phone)}</span>;
}

/**
 * The FULL address, wrapped rather than truncated — an ops person reading "why did this trip cost
 * so much" needs the whole pickup and drop, not the first thirty characters of it followed by an
 * ellipsis. Row height now varies with address length instead of being fixed to one line, which
 * is the trade this makes.
 */
function Address({ text }: { text: string }) {
  return <span className="block min-w-48 whitespace-normal break-words">{text}</span>;
}
