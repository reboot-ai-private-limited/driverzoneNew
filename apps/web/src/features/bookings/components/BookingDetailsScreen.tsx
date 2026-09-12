'use client';

import { useState, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  Car,
  Check,
  Clock,
  Copy,
  CreditCard,
  IndianRupee,
  MapPin,
  Phone,
  Printer,
  Route,
  ShieldCheck,
  Star,
  User,
  Wallet,
} from 'lucide-react';
import {
  Badge,
  Button,
  DataState,
  DefinitionList,
  FieldRow,
  PageHeader,
  Panel,
  Skeleton,
  SkeletonFieldList,
} from '@driverzone/design-system';
import type { BookingDto } from '@driverzone/contracts';
import { toErrorState } from '@/lib/api/toErrorState';
import { formatTime } from '@/lib/format';
import { useCustomer } from '@/features/customers/hooks/useCustomer';
import { useDriverDetails } from '@/features/drivers/hooks/useDriverDetails';
import { useBooking, useBookingEvents } from '../hooks/useBookings';
import { BookingActions } from './BookingActions';
import { formatBookingDate, formatBookingMobile } from '../lib/format';
import {
  paymentStatusLabel,
  paymentStatusTone,
  serviceTypeLabel,
  statusLabel,
  statusTone,
  transitionLabel,
} from '../lib/status';
import { TripRouteMap } from './TripRouteMap';

const CARD = 'flex flex-col';

export function BookingDetailsScreen() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  const query = useBooking(id);
  const booking = query.data;

  return (
    <>
      <PageHeader
        title="Booking Details"
        breadcrumbs={[
          { label: 'Home', href: '/' },
          { label: 'Bookings', href: '/bookings' },
          { label: booking?.reference ?? 'Booking Details' },
        ]}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <Button
              size="sm"
              icon={<ArrowLeft aria-hidden className="size-3.5" />}
              onClick={() => router.push('/bookings')}
            >
              Back to Bookings
            </Button>
            <Button
              size="sm"
              icon={<Printer aria-hidden className="size-3.5" />}
              onClick={() => window.print()}
              disabled={booking === undefined}
            >
              Print
            </Button>
            {/*
              No "Download Invoice". There is no invoice document anywhere in this system — no
              template, no generator, no stored PDF — and a button wired to a capability that
              cannot exist yet is worse than one that was never drawn (the same rule the bookings
              table already applies to Edit).
            */}
            {booking !== undefined && <BookingActions booking={booking} />}
          </div>
        }
      />

      <DataState
        loading={query.isLoading}
        error={
          query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined
        }
        skeleton={<DetailSkeleton />}
      >
        {booking !== undefined && <BookingBody booking={booking} />}
      </DataState>
    </>
  );
}

function BookingBody({ booking }: { booking: BookingDto }) {
  const events = useBookingEvents(booking.id);

  /*
   * THE CREATION EVENT DOUBLES AS "booking created on". There is no `created_at` on `BookingDto`
   * — the closest real thing is the first row of its own history, which `bookings.controller.ts`
   * writes with `from_status: null` at the moment the booking is made. Reaching for it here
   * rather than inventing a field means the timestamp shown is exactly the one the ledger of
   * record already has.
   */
  const createdAt = events.data?.events.find((e) => e.from_status === null)?.at ?? null;

  return (
    <div className="flex flex-col gap-4">
      <BookingSummary booking={booking} />

      {/*
        FULL WIDTH, on its own — not a grid cell. A horizontal stepper only reads as one when it
        has the whole row to spread across; squeezed into two of three grid columns it would be
        the narrowest thing on the page trying to hold the most content.
      */}
      <TripTimelineCard booking={booking} />

      {/*
        ONE grid, five cards. The map is the odd one out: it EXPLICITLY sits in column 3, rows
        1-2 (`lg:col-start-3 lg:row-start-1 lg:row-span-2`, set on its own Panel below), so it
        reads as a single full-height panel on the right — Customer/Driver on top, Fare/Payment
        underneath, both stacked to its left.

        The other four have NO position classes and simply auto-place into whatever the map's
        explicit placement leaves open — CSS Grid places every explicitly-positioned item FIRST,
        regardless of source order, so the map can be LAST in the DOM (the natural "tuck it under
        everything else" spot for the single-column mobile layout, where none of the `lg:` span
        classes apply) while still reserving column 3 before Customer/Driver/Fare/Payment are
        auto-placed into columns 1-2.

        Default `align-items: stretch` is what makes Customer and Driver (and Fare and Payment)
        equal height with each other — each Panel's body is `flex-1` (see `Panel.tsx`) precisely
        so that stretched height has somewhere to go instead of showing as dead space.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CustomerCard booking={booking} />
        <DriverCard booking={booking} />
        <FareBreakdownCard booking={booking} />
        <PaymentDetailsCard booking={booking} />
        <RouteCard booking={booking} />
      </div>

      <div className="flex flex-col items-start justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-text-subtle sm:flex-row sm:items-center">
        <span>All times are shown in Asia/Kolkata (IST).</span>
        {createdAt !== null && (
          <span>
            Booking created on {formatBookingDate(createdAt)}, {formatTime(createdAt)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Booking Summary ────────────────────────────────────────────────────────────────────────

function BookingSummary({ booking }: { booking: BookingDto }) {
  const [copied, setCopied] = useState(false);

  function copyReference() {
    void navigator.clipboard.writeText(booking.reference).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <Panel title="Booking Summary" className={CARD}>
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <SummaryStat icon={<Copy aria-hidden className="size-4" />} label="Booking ID">
          <span className="flex items-center gap-1.5">
            <span className="tabular-nums">{booking.reference}</span>
            <button
              type="button"
              onClick={copyReference}
              aria-label="Copy booking ID"
              className="text-text-subtle hover:text-interactive print:hidden"
            >
              {copied ? (
                <Check aria-hidden className="size-3.5 text-success" />
              ) : (
                <Copy aria-hidden className="size-3.5" />
              )}
            </button>
          </span>
        </SummaryStat>

        <SummaryStat icon={<Calendar aria-hidden className="size-4" />} label="Booking Date & Time">
          {formatBookingDate(booking.scheduled_at)}, {formatTime(booking.scheduled_at)}
        </SummaryStat>

        <SummaryStat icon={<Car aria-hidden className="size-4" />} label="Trip Type">
          {serviceTypeLabel(booking.service_type)}
        </SummaryStat>

        <SummaryStat icon={<ShieldCheck aria-hidden className="size-4" />} label="Status">
          <Badge tone={statusTone(booking.status)}>{statusLabel(booking.status)}</Badge>
        </SummaryStat>

        <SummaryStat icon={<CreditCard aria-hidden className="size-4" />} label="Payment Status">
          <Badge tone={paymentStatusTone(booking.status, booking.payment_mode, booking.payment_status)}>
            {paymentStatusLabel(booking.status, booking.payment_mode, booking.payment_status)}
          </Badge>
        </SummaryStat>

        <SummaryStat icon={<IndianRupee aria-hidden className="size-4" />} label="Total Amount">
          <span className="text-base font-semibold">{booking.payable.total.amount_display}</span>
        </SummaryStat>
      </div>
    </Panel>
  );
}

function SummaryStat({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-text-subtle">{icon}</span>
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-text-subtle">{label}</span>
        <span className="text-sm font-medium">{children}</span>
      </div>
    </div>
  );
}

// ─── Customer & Driver cards ────────────────────────────────────────────────────────────────

/**
 * The avatar, phone and location block shared by the customer and driver cards. What differs
 * between the two — the vehicle line, the rating, the verified badge — is each card's own
 * concern and stays out of this component rather than being threaded through as five optional
 * props.
 */
function PersonHeader({
  name,
  photoUrl,
  badge,
}: {
  name: string | null;
  photoUrl: string | null;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {photoUrl !== null ? (
        <img
          src={photoUrl}
          alt={name ?? 'Profile photo'}
          className="size-14 rounded-full border border-border object-cover"
        />
      ) : (
        <div className="flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink">
          <User aria-hidden className="size-6" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold">{name ?? 'Unnamed'}</span>
        {badge}
      </div>
    </div>
  );
}

/**
 * The customer's own record — name, phone, and their default vehicle, from a second fetch
 * (`GET /admin/customers/:id`, the same read `/customers/:id` uses). `BookingDto.customer` only
 * carries name and phone; the vehicle is real data one hop away rather than something to invent.
 *
 * NO "Verified" BADGE. There is no such concept for a customer account in this system — only
 * drivers go through admin verification — so the badge the mockup shows here has nothing to be
 * true or false about, and inventing a flag would be worse than leaving it off.
 */
function CustomerCard({ booking }: { booking: BookingDto }) {
  const detail = useCustomer(booking.customer?.id);
  const vehicle = detail.data?.vehicles.find((v) => v.is_default) ?? detail.data?.vehicles[0];

  return (
    <Panel
      title="Customer Details"
      icon={<User aria-hidden className="size-4" />}
      actions={
        booking.customer !== null ? (
          <Button
            size="sm"
            variant="ghost"
            className="print:hidden"
            onClick={() => window.open(`/customers/${booking.customer?.id}`, '_self')}
          >
            View profile
          </Button>
        ) : undefined
      }
      className={CARD}
    >
      {booking.customer === null ? (
        <NotResolved />
      ) : (
        <div className="flex flex-col gap-4">
          <PersonHeader name={booking.customer.name} photoUrl={null} />

          <div className="flex flex-col gap-2 text-sm">
            <ContactLine icon={<Phone aria-hidden className="size-3.5" />}>
              {booking.customer.phone === null ? (
                <Dash />
              ) : (
                formatBookingMobile(booking.customer.phone)
              )}
            </ContactLine>
            {vehicle !== undefined && (
              <ContactLine icon={<Car aria-hidden className="size-3.5" />}>
                {vehicle.plate_number} · {vehicle.category}
              </ContactLine>
            )}
            <ContactLine icon={<MapPin aria-hidden className="size-3.5" />}>
              {booking.pickup.address}
            </ContactLine>
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * The driver's record — name, phone, rating (both already on `BookingDto.driver`), plus
 * verification and licence number from a second fetch (`GET /admin/drivers/:id`, the same read
 * `/drivers/:id` uses). Those two are genuinely not on the booking: `is_verified` lives on the
 * driver's profile and a licence number lives among their documents, so this is real data one
 * hop away, the same trade the customer card makes for its vehicle.
 */
function DriverCard({ booking }: { booking: BookingDto }) {
  const detail = useDriverDetails(booking.driver?.id ?? '', booking.driver !== null);
  const licence = detail.data?.documents.find((d) => d.doc_type === 'LICENCE' && d.number !== null);

  return (
    <Panel
      title="Driver Details"
      icon={<Car aria-hidden className="size-4" />}
      actions={
        booking.driver !== null ? (
          <Button
            size="sm"
            variant="ghost"
            className="print:hidden"
            onClick={() => window.open(`/drivers/${booking.driver?.id}`, '_self')}
          >
            View profile
          </Button>
        ) : undefined
      }
      className={CARD}
    >
      {booking.driver === null ? (
        <div className="flex h-full items-center justify-center py-8 text-sm text-text-subtle">
          No driver has taken this booking yet.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <PersonHeader
            name={booking.driver.name}
            photoUrl={booking.driver.photo_url}
            badge={
              detail.data?.profile.is_verified === true ? (
                <Badge tone="success">Verified</Badge>
              ) : undefined
            }
          />

          <div className="flex flex-col gap-2 text-sm">
            <ContactLine icon={<Phone aria-hidden className="size-3.5" />}>
              {booking.driver.phone === null ? <Dash /> : formatBookingMobile(booking.driver.phone)}
            </ContactLine>
            {licence !== undefined && (
              <ContactLine icon={<ShieldCheck aria-hidden className="size-3.5" />}>
                {licence.number}
              </ContactLine>
            )}
            {detail.data?.profile.address !== null && detail.data?.profile.address !== undefined && (
              <ContactLine icon={<MapPin aria-hidden className="size-3.5" />}>
                {detail.data.profile.address}
              </ContactLine>
            )}
            <ContactLine icon={<Star aria-hidden className="size-3.5 fill-warning text-warning" />}>
              {booking.driver.rating === null ? (
                <span className="text-text-subtle">Not yet rated</span>
              ) : (
                <>
                  {booking.driver.rating.toFixed(1)}{' '}
                  <span className="text-text-subtle">({booking.driver.rating_count} ratings)</span>
                </>
              )}
            </ContactLine>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ContactLine({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-text-subtle">
      <span className="shrink-0">{icon}</span>
      <span className="text-text">{children}</span>
    </div>
  );
}

function NotResolved() {
  return (
    <div className="flex h-full items-center justify-center py-8 text-sm text-text-subtle">
      Not resolved on this read.
    </div>
  );
}

function Dash() {
  return <span className="text-text-subtle">—</span>;
}

// ─── Pickup & Destination ───────────────────────────────────────────────────────────────────

/**
 * Real elapsed time — `started_at` to `completed_at` — not an ETA. The mockup shows a pre-trip
 * estimate; a completed booking has something better than an estimate, which is what actually
 * happened, so that is what this shows. A trip still in progress or that never started has
 * nothing to compute yet and this returns `null` rather than guessing.
 */
function tripDurationMinutes(booking: BookingDto): number | null {
  const { started_at, completed_at } = booking.timestamps;
  if (started_at === null || completed_at === null) return null;
  return Math.round((new Date(completed_at).getTime() - new Date(started_at).getTime()) / 60_000);
}

/**
 * Explicitly placed at column 3, rows 1-2 — see the comment on the grid in `BookingBody`. The
 * map itself is `flex-1`, not a fixed height: this card is now as tall as Customer/Driver plus
 * Fare/Payment combined, and a map that stayed the height it was in the old three-card row would
 * leave most of this card as the exact dead space the grid stretch fix exists to avoid.
 */
function RouteCard({ booking }: { booking: BookingDto }) {
  const duration = tripDurationMinutes(booking);

  return (
    <Panel
      title="Pickup & Destination"
      icon={<MapPin aria-hidden className="size-4" />}
      className={`${CARD} lg:col-start-3 lg:row-start-1 lg:row-span-2`}
    >
      <div className="flex h-full flex-col gap-3">
        <div className="min-h-48 flex-1 overflow-hidden rounded-md">
          <TripRouteMap pickup={booking.pickup} drop={booking.drop} />
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <div className="flex items-start gap-2">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-success" />
            <div>
              <div className="text-xs text-text-subtle">Pickup Location</div>
              <div className="font-medium">{booking.pickup.address}</div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-danger" />
            <div>
              <div className="text-xs text-text-subtle">Destination</div>
              <div className="font-medium">{booking.drop.address}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 border-t border-border pt-3 text-xs text-text-subtle">
          <span className="flex items-center gap-1.5">
            <Route aria-hidden className="size-3.5" />
            {booking.distance_km === null ? 'Distance not recorded' : `${booking.distance_km.toFixed(1)} km`}
          </span>
          <span className="flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5" />
            {duration === null ? 'Duration not available' : `${duration} mins`}
          </span>
        </div>
      </div>
    </Panel>
  );
}

// ─── Trip Timeline ──────────────────────────────────────────────────────────────────────────

/**
 * `booking.status` TRANSITIONS ONLY — not "OTP Sent" or "OTP Verified", which the mockup this
 * page was built from shows alongside the four-digit code itself. That code exists so the
 * customer can prove themselves to the driver in person; `BookingDto.start_otp` is null on
 * every admin read for exactly that reason, and no booking EVENT records it either (confirmed
 * against `startTrip.usecase.ts` — the STARTED transition's metadata is empty). A timeline
 * that showed it would be a genuine data leak, not a cosmetic simplification, so it is not
 * built here at all rather than built with a placeholder.
 */
function TripTimelineCard({ booking }: { booking: BookingDto }) {
  const events = useBookingEvents(booking.id);

  return (
    <Panel title="Trip Timeline" icon={<Clock aria-hidden className="size-4" />} className={CARD}>
      <DataState
        loading={events.isLoading}
        error={events.isError ? toErrorState(events.error, () => void events.refetch()) : undefined}
        empty={(events.data?.events.length ?? 0) === 0}
        emptyState={{
          title: 'No transitions recorded',
          description: 'Events are written as the booking moves through its statuses.',
        }}
        skeleton={<SkeletonFieldList rows={4} />}
      >
        {/*
          A horizontal stepper, not a vertical list — left to right, each event its own column,
          spread across the panel's full width (which is the whole page, since this Panel is not
          in the three-column grid the rest of the cards sit in). `overflow-x-auto` is the escape
          hatch on a narrow viewport: an eight-step trip does not fit eight even columns on a
          phone, and letting the row scroll beats shrinking every label to nothing.

          ON PRINT, scrolling is not an option — nothing past the edge of the page can be
          scrolled to, so a scrollable row just cuts its later steps off. `print:flex-wrap` plus
          `print:overflow-visible` turns the row into as many rows as the printed width needs,
          and each `<li>` gets a fixed `print:basis-40` (not `flex-1`) so wrapped rows have a
          consistent number of columns instead of one giant unbroken line trying to fit anyway.
        */}
        <ol className="flex items-start gap-1 overflow-x-auto pb-1 print:flex-wrap print:overflow-visible">
          {events.data?.events.map((event, index) => {
            const isFirst = index === 0;
            const isLast = index === (events.data?.events.length ?? 0) - 1;
            return (
              <li
                key={`${event.at}-${event.to_status}`}
                className="flex min-w-32 flex-1 flex-col items-center text-center print:flex-none print:basis-40"
              >
                {/*
                  The connecting line, built from two half-segments per step rather than one
                  line spanning the whole row: each `<li>` owns exactly the width its dot sits
                  in, so the line's segments always meet AT the dot regardless of how many steps
                  there are or how wide the panel is.
                */}
                <div className="flex w-full items-center">
                  <span className={`h-px flex-1 ${isFirst ? 'invisible' : 'bg-border'}`} />
                  <span className="mx-1 size-2.5 shrink-0 rounded-full bg-interactive" />
                  <span className={`h-px flex-1 ${isLast ? 'invisible' : 'bg-border'}`} />
                </div>

                <span className="mt-2 text-xs font-medium tabular-nums text-text-subtle">
                  {formatTime(event.at)}
                </span>
                <span className="mt-0.5 text-sm font-medium">
                  {event.from_status === null ? 'Booking created' : transitionLabel(event.to_status)}
                </span>
                <span className="text-xs text-text-subtle">
                  by {event.actor_type.toLowerCase()}
                  {event.reason === null ? '' : ` · ${event.reason}`}
                </span>
              </li>
            );
          })}
        </ol>
      </DataState>
    </Panel>
  );
}

// ─── Fare Breakdown ─────────────────────────────────────────────────────────────────────────

function FareBreakdownCard({ booking }: { booking: BookingDto }) {
  const { fare, adjustments, wallet_credit } = booking;
  const saved = wallet_credit.amount_paise > 0;

  return (
    <Panel title="Fare Breakdown" icon={<IndianRupee aria-hidden className="size-4" />} className={CARD}>
      <div className="flex flex-1 flex-col justify-between gap-3">
        <DefinitionList>
          {fare.lines.map((line) => (
            <FieldRow key={line.code} label={line.label}>
              {line.amount.amount_display}
            </FieldRow>
          ))}
          {adjustments.map((adjustment) => (
            <FieldRow key={adjustment.type} label={adjustment.label}>
              {adjustment.amount.amount_display}
            </FieldRow>
          ))}
          {wallet_credit.amount_paise > 0 && (
            <FieldRow label="Wallet credit applied">
              <span className="text-success">− {wallet_credit.amount_display}</span>
            </FieldRow>
          )}
          {booking.wallet_debt.amount_paise > 0 && (
            <FieldRow label="Carried debt">{booking.wallet_debt.amount_display}</FieldRow>
          )}
        </DefinitionList>

        {/*
          `payable.total`, NOT `fare.total`. The fare is frozen at booking time (invariant B-1) and
          says nothing about an extra day the driver agreed to, the waiting charge or the wallet —
          all three of which are listed as rows immediately above this line. Printing the frozen
          figure under them made a column that visibly did not add up, and it is the number support
          reads out when a customer disputes what they were charged.
        */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm font-semibold">Total Amount</span>
          <span className="text-base font-semibold">{booking.payable.total.amount_display}</span>
        </div>

        {saved && (
          <div className="flex items-center justify-between rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            <span className="flex items-center gap-1.5">
              <Wallet aria-hidden className="size-4" />
              You Saved
            </span>
            <span className="font-semibold">{wallet_credit.amount_display}</span>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ─── Payment Details ────────────────────────────────────────────────────────────────────────

/**
 * NO TRANSACTION ID. Nothing in this stack exposes a gateway reference to the admin panel today
 * — `payments` has no admin-facing read at all, only the provider's webhook — so a field the
 * mockup shows here has no real value to put in it. Shown instead: the method, the derived
 * status, and when it happened, all backed by data this read already carries.
 */
function PaymentDetailsCard({ booking }: { booking: BookingDto }) {
  const events = useBookingEvents(booking.id);

  /*
   * UPI is paid the moment the booking leaves PENDING_PAYMENT — the CONFIRMED event's timestamp.
   * CASH is collected at the end — `completed_at`. Neither is invented; both are read off events
   * that already exist for a different reason.
   */
  const paidAt =
    booking.payment_mode === 'UPI' && booking.payment_status === 'PAID'
      ? (events.data?.events.find((e) => e.to_status === 'CONFIRMED' || e.metadata?.paymentStatus === 'PAID')?.at ?? null)
      : booking.timestamps.completed_at;

  return (
    <Panel title="Payment Details" icon={<CreditCard aria-hidden className="size-4" />} className={CARD}>
      <DefinitionList>
        <FieldRow label="Payment Method">{booking.payment_mode ?? 'Not selected'}</FieldRow>
        <FieldRow label="Payment Status">
          <Badge tone={paymentStatusTone(booking.status, booking.payment_mode, booking.payment_status)}>
            {paymentStatusLabel(booking.status, booking.payment_mode, booking.payment_status)}
          </Badge>
        </FieldRow>
        {paidAt !== null && (
          <FieldRow label="Paid At">
            {formatBookingDate(paidAt)}, {formatTime(paidAt)}
          </FieldRow>
        )}
        <FieldRow label="Amount">{booking.payable.total.amount_display}</FieldRow>
      </DefinitionList>
    </Panel>
  );
}

// ─── Loading ────────────────────────────────────────────────────────────────────────────────

/** Mirrors the real grid's shape — see `BookingBody` — so the page does not reflow when it loads. */
function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-28 rounded-md" />
      <Skeleton className="h-32 rounded-md" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Skeleton className="min-h-40 rounded-md" />
        <Skeleton className="min-h-40 rounded-md" />
        <Skeleton className="min-h-40 rounded-md" />
        <Skeleton className="min-h-40 rounded-md" />
        <Skeleton className="min-h-40 rounded-md lg:col-start-3 lg:row-start-1 lg:row-span-2" />
      </div>
    </div>
  );
}
