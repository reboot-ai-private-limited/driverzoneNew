import type { BadgeTone } from '@driverzone/design-system';
import {
  BOOKING_STATUSES,
  type BookingPaymentMode,
  type BookingPaymentStatus,
  type BookingStatus,
  type ExtrasCollection,
  type OnlinePaymentDto,
  type ServiceType,
} from '@driverzone/contracts';

/**
 * The thirteen `BookingStatus`es, grouped into the handful an admin actually filters by.
 *
 * A status dropdown with thirteen entries — three of which are only "who pressed cancel" — asks
 * the reader to know the state machine before they can use the screen. These six groups are the
 * questions ops actually asks: is it waiting, running, done, called off, did nobody take it, or
 * did the customer just never pay.
 *
 * THE GROUPING LIVES HERE, NOT ON THE SERVER. The wire carries raw statuses
 * (`?status=ASSIGNED,STARTED`, see `endpoints/bookings.ts`) so that deciding a seventh group is
 * clearer stays a change to this file alone.
 *
 * `NO_DRIVER_FOUND` and `EXPIRED` are each their own group rather than folded into Cancelled.
 * Nobody called either one off — a wave that finds no one and a checkout nobody finished are both
 * dispatch/payment problems to investigate, and burying them among a customer's own cancellations
 * is how they stop being noticed.
 */
export const STATUS_GROUPS = {
  SCHEDULED: ['PENDING_PAYMENT', 'CONFIRMED', 'SEARCHING'],
  /*
   * ITS OWN GROUP, for the same reason `NO_DRIVER` and `EXPIRED` are. A parked scheduled booking
   * is the single most actionable row in this table: the search has already run once and found
   * nobody, and ops has until T−90 to fix it by phone. Folding it into Scheduled — which is where
   * it would land by default, since `groupOf` falls back there — hides the one state that is
   * asking for a human.
   */
  WAITING: ['WAITING_DRIVER'],
  ONGOING: ['ASSIGNED', 'DRIVER_EN_ROUTE', 'ARRIVED', 'STARTED'],
  COMPLETED: ['COMPLETED'],
  CANCELLED: ['CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_DRIVER', 'CANCELLED_BY_ADMIN'],
  NO_DRIVER: ['NO_DRIVER_FOUND'],
  EXPIRED: ['EXPIRED'],
} as const satisfies Record<string, readonly BookingStatus[]>;

export type StatusGroup = keyof typeof STATUS_GROUPS;

export const STATUS_GROUP_LABELS: Record<StatusGroup, string> = {
  SCHEDULED: 'Scheduled',
  WAITING: 'Waiting for driver',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  NO_DRIVER: 'No driver found',
  EXPIRED: 'Payment expired',
};

const GROUP_TONES: Record<StatusGroup, BadgeTone> = {
  SCHEDULED: 'warning',
  WAITING: 'warning',
  ONGOING: 'info',
  COMPLETED: 'success',
  CANCELLED: 'danger',
  NO_DRIVER: 'neutral',
  EXPIRED: 'neutral',
};

/** Built once at module scope: a reverse lookup rebuilt per row is thirteen entries per render. */
const GROUP_OF: Record<string, StatusGroup> = Object.fromEntries(
  Object.entries(STATUS_GROUPS).flatMap(([group, statuses]) =>
    statuses.map((status) => [status, group as StatusGroup]),
  ),
);

/**
 * A COMPILE-TIME CHECK, not a runtime one: this array exists only so that `BOOKING_STATUSES`
 * gaining a member `GROUP_OF` doesn't cover is a type error here, not a status silently
 * misfiled into Scheduled the next time someone adds one to contracts. That is exactly the gap
 * `EXPIRED` fell into once already — `STATUS_GROUPS`'s `satisfies` checks that every member it
 * lists is a valid `BookingStatus`, not that every `BookingStatus` is listed somewhere.
 */
const _exhaustive: readonly StatusGroup[] = BOOKING_STATUSES.map((status) => {
  const group = GROUP_OF[status];
  if (group === undefined) {
    throw new Error(`STATUS_GROUPS has no group for "${status}" — add one in features/bookings/lib/status.ts`);
  }
  return group;
});
void _exhaustive;

export function groupOf(status: BookingStatus): StatusGroup {
  // The fallback is unreachable in practice — `_exhaustive` above throws at module load if
  // `STATUS_GROUPS` ever again falls short of `BOOKING_STATUSES` — and stays only so this
  // function's own return type is `StatusGroup`, never `StatusGroup | undefined`.
  return GROUP_OF[status] ?? 'SCHEDULED';
}

export function statusTone(status: BookingStatus): BadgeTone {
  return GROUP_TONES[groupOf(status)];
}

/**
 * What the chip reads.
 *
 * The GROUP for the ordinary run of statuses, because "Ongoing" is what ops means. The three
 * cancellations are the exception: who called it off is the entire content of that row, and a
 * table of identical "Cancelled" chips makes the one useful question — was this the driver
 * again? — unanswerable without opening every one.
 */
export function statusLabel(status: BookingStatus): string {
  switch (status) {
    case 'CANCELLED_BY_CUSTOMER':
      return 'Cancelled · customer';
    case 'CANCELLED_BY_DRIVER':
      return 'Cancelled · driver';
    case 'CANCELLED_BY_ADMIN':
      return 'Cancelled · admin';
    default:
      return STATUS_GROUP_LABELS[groupOf(status)];
  }
}

/**
 * The trip-type chip.
 *
 * TWO VALUES, because `SERVICE_TYPES` has two. The design this screen was built from shows five
 * — In City, Mini Outstation, Hill Package, Outstation, Long Distance — but three of those are
 * not in the data under any name: a booking carries `service_type` and nothing that distinguishes
 * a hill package from any other outstation run. Rendering five chips off two values would mean
 * inventing the difference per row, so the table shows what the booking actually says.
 */
export function serviceTypeLabel(serviceType: ServiceType): string {
  return serviceType === 'INCITY' ? 'In City' : 'Outstation';
}

export function serviceTypeTone(serviceType: ServiceType): BadgeTone {
  return serviceType === 'INCITY' ? 'info' : 'accent';
}

/**
 * Whether the fare has actually been collected.
 *
 * EVERY BOOKING IS PAY-AT-END. The method is chosen after the trip starts — cash to the driver, or
 * online through Razorpay — so until then `payment_mode` is null and nothing is owed yet:
 *   - `payment_status: 'PAID'` from the server is the only thing that says "Paid" for online.
 *   - no method yet → "Not chosen yet", or "Not collected" if the trip never happened.
 *   - CASH reads as due until `COMPLETED`, uncollected if the trip was cancelled first.
 *   - UPI chosen but not captured reads as pending until it is.
 */
export function paymentStatusLabel(
  status: BookingStatus,
  paymentMode: BookingPaymentMode | null,
  paymentStatus?: BookingPaymentStatus,
): string {
  // Before the generic "Paid": a prepaid booking was paid OFFLINE, and ops reading "Paid" on a
  // trip that has not even started would go looking for an online payment that does not exist.
  if (paymentMode === 'PREPAID') return 'Prepaid';
  if (paymentStatus === 'PAID') return 'Paid';
  if (paymentMode === null) {
    if (groupOf(status) === 'CANCELLED' || status === 'NO_DRIVER_FOUND' || status === 'EXPIRED') {
      return 'Not collected';
    }
    return 'Not chosen yet';
  }

  if (status === 'PENDING_PAYMENT') return 'Pending';

  // `EXPIRED` is ONLY reachable from `PENDING_PAYMENT` (`booking.entity.ts`'s transition table) —
  // the payment window lapsed with nothing collected. Checked before the CASH/UPI split below,
  // because falling through to it would have said "Paid" for a UPI booking that was, precisely,
  // never paid.
  if (status === 'EXPIRED') return 'Not collected';

  if (paymentMode === 'CASH') {
    if (status === 'COMPLETED') return 'Paid';
    if (groupOf(status) === 'CANCELLED' || status === 'NO_DRIVER_FOUND') return 'Not collected';
    return 'Due at trip end';
  }

  if (paymentMode === 'UPI') {
    if (status === 'COMPLETED') return 'Paid';
    return 'Pending';
  }

  return 'Paid';
}

export function paymentStatusTone(
  status: BookingStatus,
  paymentMode: BookingPaymentMode | null,
  paymentStatus?: BookingPaymentStatus,
): BadgeTone {
  const label = paymentStatusLabel(status, paymentMode, paymentStatus);
  if (label === 'Paid' || label === 'Prepaid') return 'success';
  if (label === 'Pending' || label === 'Due at trip end' || label === 'Not chosen yet') return 'warning';
  return 'neutral';
}

/** How the payment method reads on the booking page. */
export function paymentModeLabel(
  mode: BookingPaymentMode | null,
  /** How the online payment was made, when one has been captured. Admin single read only. */
  onlinePayment: OnlinePaymentDto | null = null,
): string {
  if (mode === 'PREPAID') return 'Prepaid (paid offline)';
  // The driver's QR is "UPI" too — and the thing support needs to know is that the customer paid by
  // scanning it, not from their own app, which is a different place to look when it goes wrong.
  if (mode === 'UPI') return onlinePayment?.channel === 'QR' ? 'UPI (QR scanned at the trip)' : 'Online (UPI)';
  if (mode === 'CASH') return 'Cash';
  return 'Not selected';
}

/** How the trip's extras were settled at the end, as the driver reported it. */
export const EXTRAS_COLLECTION_LABELS: Record<ExtrasCollection, string> = {
  CASH: 'Collected in cash by the driver',
  ONLINE: 'Charged online',
  UNPAID: 'Not paid — added to the customer’s dues',
};

/**
 * One distinct label per raw `BookingStatus`, for a TIMELINE — where the whole point is telling
 * consecutive steps apart. `statusLabel` above is the wrong tool here: it exists for the filter
 * dropdown and the table's Status column, where ASSIGNED, DRIVER_EN_ROUTE, ARRIVED and STARTED
 * are deliberately one word, "Ongoing" — a completed trip's timeline would otherwise read
 * "Ongoing, Ongoing, Ongoing, Ongoing, Completed", the same word four times over four real,
 * different events.
 */
/*
 * `CONFIRMED` IS NOT A PAYMENT. Every booking is pay-at-end — cash to the driver or online once
 * the trip has started — and `createBooking` moves PENDING_PAYMENT → CONFIRMED in the same request
 * with nothing paid. "Payment Confirmed" was left over from when UPI was prepaid, and it told ops a
 * customer had paid who had not.
 */
const TRANSITION_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'Booking Received',
  CONFIRMED: 'Booking Confirmed',
  SEARCHING: 'Searching for Driver',
  WAITING_DRIVER: 'Waiting for a Driver',
  ASSIGNED: 'Driver Assigned',
  DRIVER_EN_ROUTE: 'Driver En Route',
  ARRIVED: 'Driver Arrived',
  STARTED: 'Trip Started',
  COMPLETED: 'Trip Completed',
  CANCELLED_BY_CUSTOMER: 'Cancelled by Customer',
  CANCELLED_BY_DRIVER: 'Cancelled by Driver',
  CANCELLED_BY_ADMIN: 'Cancelled by Admin',
  NO_DRIVER_FOUND: 'No Driver Found',
  EXPIRED: 'Expired',
};

export function transitionLabel(status: BookingStatus): string {
  return TRANSITION_LABELS[status];
}
