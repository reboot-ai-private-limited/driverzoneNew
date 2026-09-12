'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarCheck,
  CarFront,
  CircleSlash,
  Coins,
  FileClock,
  Navigation,
  SearchX,
  Star,
} from 'lucide-react';
import type { BookingDto } from '@driverzone/contracts';
import {
  Badge,
  DataState,
  DataTable,
  PageHeader,
  Panel,
  StatTile,
  type Column,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatDate, formatTime } from '@/lib/format';
import { statusLabel, statusTone } from '@/features/bookings/lib/status';
import {
  useActionQueues,
  useBookingCountsToday,
  useDriversOverDebtLimit,
  useLiveDrivers,
  useRecentBookings,
} from '../hooks/useDashboardMetrics';

/**
 * The landing screen — "what needs my attention now".
 *
 * AN OPS CONSOLE, NOT A KPI BOARD. Every number here is either a thing happening right now or a
 * queue with work in it, and each queue tile is a LINK to the filtered list that clears it. That
 * is the whole difference between a dashboard somebody uses and a wall of figures they scroll
 * past: the tile is where the job starts, not where it is reported.
 *
 * Deliberately absent: revenue, and any trend line. Neither has an endpoint — the ledger totals
 * driver-side money, which is not revenue, and nothing groups by day. A plausible-looking figure
 * derived from the wrong source would be worse than the gap, because nobody would know to doubt it.
 */

/**
 * `ssr: false`, like the zone editor's map and for the same reason: the Maps JS API reaches for
 * `window` on import. It also keeps the Google bundle off the first paint of the landing screen —
 * the tiles are what an admin came for, and they should not wait on a map to render.
 */
const LiveDriverMap = dynamic(
  () => import('./LiveDriverMap').then((module) => module.LiveDriverMap),
  { ssr: false, loading: () => <div className="h-80 w-full rounded-md bg-surface-muted" /> }
);

/**
 * A number that could not be loaded shows an em dash, never `0`.
 *
 * THE ONE RULE THIS SCREEN CANNOT BREAK. A queue tile reading zero says "nothing to do" and is
 * acted on by doing nothing, so a failed request that renders as `0` is indistinguishable from an
 * empty queue and quietly hides work. An em dash is visibly not an answer.
 */
function stat(value: number | undefined, failed: boolean): string {
  if (failed || value === undefined) return '—';
  return String(value);
}

export function DashboardScreen() {
  const router = useRouter();

  const counts = useBookingCountsToday();
  const live = useLiveDrivers();
  const queues = useActionQueues();
  const debt = useDriversOverDebtLimit();
  const recent = useRecentBookings();

  const today = counts.data;
  const queueData = queues.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        breadcrumbs={[{ label: 'Home' }]}
      />

      <div className="flex flex-col gap-6">
        <Section title="Today">
          <StatTile
            label="Bookings"
            icon={<CalendarCheck aria-hidden className="size-4" />}
            loading={counts.isLoading}
            value={stat(today?.total, counts.isError)}
            hint="Pickups scheduled for today"
          />
          <StatTile
            label="Completed"
            icon={<CarFront aria-hidden className="size-4" />}
            loading={counts.isLoading}
            tone="success"
            value={stat(today?.completed, counts.isError)}
          />
          <StatTile
            label="Cancelled"
            icon={<CircleSlash aria-hidden className="size-4" />}
            loading={counts.isLoading}
            tone="warning"
            value={stat(today?.cancelled, counts.isError)}
          />
        </Section>

        <Section title="Live now">
          <StatTile
            label="Drivers on duty"
            icon={<Navigation aria-hidden className="size-4" />}
            loading={live.isLoading}
            value={stat(live.data?.total_active, live.isError)}
            /* On duty AND still reporting. A driver on duty whose app died is counted by neither
               this tile nor dispatch, which is the honest answer to "how much supply do I have". */
            hint="On duty and reporting a position"
          />
          <StatTile
            label="Trips in flight"
            icon={<CarFront aria-hidden className="size-4" />}
            loading={counts.isLoading}
            /* Not scoped to today — see the note in `useBookingCountsToday`. */
            value={stat(today?.ongoing, counts.isError)}
            hint="Assigned, en route, arrived or started"
          />
        </Section>

        {/* Each of these is a queue with a person's work in it, so each one is a link. */}
        <Section title="Needs action">
          <ActionTile
            label="Awaiting verification"
            icon={<FileClock aria-hidden className="size-4" />}
            loading={queues.isLoading}
            value={stat(queueData?.awaitingVerification, queues.isError)}
            hint="Drivers who have submitted documents"
            href="/drivers?tab=requests&status=SUBMITTED"
          />
          <ActionTile
            label="No driver found"
            icon={<SearchX aria-hidden className="size-4" />}
            loading={counts.isLoading}
            tone="danger"
            value={stat(today?.noDriver, counts.isError)}
            hint="Today — every wave came back empty"
            href="/bookings?status=NO_DRIVER"
          />
          <ActionTile
            label="Low ratings"
            icon={<Star aria-hidden className="size-4" />}
            loading={queues.isLoading}
            tone="warning"
            value={stat(queueData?.lowRatedReviews, queues.isError)}
            hint="Rated two stars or below"
            href="/reviews"
          />
          <ActionTile
            label="Over debt limit"
            icon={<Coins aria-hidden className="size-4" />}
            loading={debt.isLoading}
            tone="danger"
            value={stat(debt.data?.pagination.total_items, debt.isError)}
            hint="Not being offered trips until they settle"
            href="/finance"
          />
        </Section>

        <Panel title="Where drivers are">
          <DataState
            loading={live.isLoading}
            skeleton={<div className="h-80 w-full rounded-md bg-surface-muted" />}
            error={live.isError ? toErrorState(live.error, () => live.refetch()) : undefined}
            empty={live.data?.drivers.length === 0}
            emptyState={{
              icon: <Navigation aria-hidden className="size-6" />,
              title: 'Nobody is reporting a position',
              description:
                'Drivers appear here while their app is running. An empty map outside working hours is normal.',
            }}
          >
            {/* Everyone here is on duty — the query asks for nobody else. Yellow means their last
                fix is inside dispatch's two-minute window, so a wave can reach them; grey means it
                is not, which is a driver sitting on duty whom no trip can currently be routed to. */}
            <LiveDriverMap drivers={live.data?.drivers ?? []} />
          </DataState>
        </Panel>

        <Panel title="Recent bookings">
          <DataState
            loading={recent.isLoading}
            skeleton={<div className="h-64" />}
            error={recent.isError ? toErrorState(recent.error, () => recent.refetch()) : undefined}
            empty={recent.data?.bookings.length === 0}
            emptyState={{
              icon: <CalendarCheck aria-hidden className="size-6" />,
              title: 'No bookings yet',
              description: 'New bookings appear here as they are made.',
            }}
          >
            <DataTable
              columns={RECENT_COLUMNS}
              rows={recent.data?.bookings ?? []}
              rowKey={(booking) => booking.id}
              onRowClick={(booking) => router.push(`/bookings/${booking.id}`)}
              refetching={recent.isFetching && !recent.isLoading}
            />
          </DataState>
        </Panel>
      </div>
    </>
  );
}

/** A labelled row of tiles. The label is what makes three numbers a group rather than a list. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
    </section>
  );
}

/**
 * A tile that is also the way in.
 *
 * `Link` wrapping the tile rather than a button inside it: the whole card is the target, which is
 * both a bigger hit area and the behaviour people already expect from a card with a number on it.
 */
function ActionTile({
  href,
  ...tile
}: { href: string } & React.ComponentProps<typeof StatTile>) {
  return (
    <Link
      href={href}
      className="rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-focus hover:shadow-sm"
    >
      <StatTile {...tile} />
    </Link>
  );
}

const RECENT_COLUMNS: Column<BookingDto>[] = [
  {
    key: 'reference',
    header: 'Reference',
    width: 'w-32',
    render: (booking) => <span className="font-medium text-text">{booking.reference}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 'w-36',
    render: (booking) => (
      <Badge tone={statusTone(booking.status)}>{statusLabel(booking.status)}</Badge>
    ),
  },
  {
    key: 'pickup',
    header: 'Pickup',
    width: 'w-64',
    render: (booking) => (
      <span className="text-text-subtle">{booking.pickup.address}</span>
    ),
  },
  {
    key: 'when',
    header: 'Scheduled',
    width: 'w-40',
    render: (booking) => (
      <div className="flex flex-col">
        <span className="text-text">{formatDate(booking.scheduled_at)}</span>
        <span className="text-xs text-text-subtle tnum">{formatTime(booking.scheduled_at)}</span>
      </div>
    ),
  },
];
