import type { BookingDto, BookingStatus } from '@driverzone/contracts';
import { formatPaise } from '@/lib/money';

/**
 * Ride history rows, adapted from the real `BookingDto`.
 *
 * REPLACES `demoRides.ts`, whose own header named the condition for its deletion: "when the list
 * endpoint ships, this file is what gets deleted". `GET /customer/bookings` now exists, so it is.
 *
 * WHY AN ADAPTER RATHER THAN THE DTO STRAIGHT INTO THE SCREEN. The list has to answer three
 * questions the DTO does not: which of thirteen statuses this row counts as, which of six
 * timestamps is "when the ride happened", and what a row is worth once adjustments are added to
 * the fare. Doing that inline would put the same three decisions in the list screen, the detail
 * screen and the stats block, where they could drift apart. It also keeps `id` (for routing) and
 * `reference` (for reading and searching) from being confused with each other, which the demo
 * data conflated because its ids were display strings.
 *
 * WHAT IS GONE, AND WHY IT IS NOT INVENTED HERE. The demo rows carried a driver rating, a driver
 * phone, years of experience, a vehicle list, a transaction id and a discount line. None exists
 * anywhere in `@driverzone/contracts`, so the screens that showed them no longer do. Substituting
 * a plausible-looking constant would be the demo data again, without the badge that admitted it.
 */

export type RideStatus = 'COMPLETED' | 'CANCELLED' | 'RUNNING';

export interface RideHistoryRow {
  /** The booking's id — what `/rides/[id]` routes on. Never shown. */
  id: string;
  /** `DZ-8F3K2M`. What the customer reads, and what a search matches against. */
  reference: string;
  status: RideStatus;
  /** ISO 8601. When the ride HAPPENED — see `rideHappenedAt`. */
  at: string;
  driverName: string | null;
  pickup: string;
  drop: string;
  /** Fare plus adjustments, in paise. Sorting needs a number, not a formatted string. */
  totalPaise: number;
  /**
   * What actually left the customer's pocket: the total, less wallet credit, plus any older debt
   * collected with this trip.
   *
   * A SECOND FIGURE RATHER THAN A REPLACEMENT, because the two answer different questions. The row
   * shows what the TRIP cost — that is the price of the service and what sorting by amount should
   * rank on. "Total Spent" is money out of pocket, and counting a ₹714 trip that credit reduced to
   * ₹564 as ₹714 of spending would be wrong on the one tile that claims to add up.
   */
  paidPaise: number;
  /** The server's own formatting of that total, so all four clients render it identically. */
  totalDisplay: string;
}

const CANCELLED_STATUSES = new Set<BookingStatus>([
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  /*
   * A trip that never found a driver, and one that expired unpaid, are CANCELLED to a customer
   * reading their history. Neither completed, and neither is still running — "Cancelled" is the
   * only one of the three filters that is true of them, and inventing a fourth for two edge
   * statuses would put a filter chip on the screen that matches almost nothing.
   */
  'NO_DRIVER_FOUND',
  'EXPIRED',
]);

export function toRideStatus(status: BookingStatus): RideStatus {
  if (status === 'COMPLETED') return 'COMPLETED';
  return CANCELLED_STATUSES.has(status) ? 'CANCELLED' : 'RUNNING';
}

/**
 * When the ride happened, for display and for "Today"/"This Month".
 *
 * PREFERS WHAT ACTUALLY OCCURRED over what was planned: a trip completed at 9pm belongs under
 * 9pm, not under the 6pm it was scheduled for. `scheduled_at` is the fallback because it is the
 * only timestamp a booking is guaranteed to have — a ride still searching for a driver has no
 * other date to file it under.
 */
export function rideHappenedAt(booking: BookingDto): string {
  return booking.timestamps.completed_at ?? booking.timestamps.cancelled_at ?? booking.scheduled_at;
}

/**
 * What the trip cost: the quoted fare plus anything decided afterwards.
 *
 * `adjustments` (waiting time, a late fine) never edit `fare` — that is invariant B-1 — so a row
 * showing `fare.total` alone would under-report every trip that ran long, and disagree with the
 * detail screen's own invoice, which lists both.
 */
export function rideTotalPaise(booking: BookingDto): number {
  return booking.adjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount.amount_paise,
    booking.fare.total.amount_paise,
  );
}

export function toRideHistoryRow(booking: BookingDto): RideHistoryRow {
  const totalPaise = rideTotalPaise(booking);

  return {
    id: booking.id,
    reference: booking.reference,
    status: toRideStatus(booking.status),
    at: rideHappenedAt(booking),
    driverName: booking.driver?.name ?? null,
    pickup: booking.pickup.address,
    drop: booking.drop.address,
    totalPaise,
    paidPaise: Math.max(
      0,
      totalPaise - booking.wallet_credit.amount_paise + booking.wallet_debt.amount_paise,
    ),
    /*
     * The server's string is only correct while nothing has been added to the fare. With an
     * adjustment there is no preformatted total for fare+adjustments, so this formats it — which
     * is why `formatPaise` exists here at all rather than every total coming down the wire.
     */
    totalDisplay:
      totalPaise === booking.fare.total.amount_paise
        ? booking.fare.total.amount_display
        : formatPaise(totalPaise),
  };
}

