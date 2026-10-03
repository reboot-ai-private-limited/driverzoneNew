import {
  RIDE_HISTORY_CANCELLED_STATUSES,
  RIDE_HISTORY_PRE_DISPATCH_STATUSES,
  type BookingDto,
  type BookingStatus,
} from '@driverzone/contracts';
import type { TripPoint } from '@/features/booking/tripPoint';
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

export type RideStatus = 'COMPLETED' | 'CANCELLED' | 'RUNNING' | 'SCHEDULED';

export interface RideHistoryRow {
  /** The booking's id — what `/rides/[id]` routes on. Never shown. */
  id: string;
  /** `DZ-8F3K2M`. What the customer reads, and what a search matches against. */
  reference: string;
  status: RideStatus;
  /**
   * Whether the trip is over, which is a different question from `status === 'COMPLETED'` — a
   * cancelled trip is finished too. The list routes on it: a finished ride opens its receipt, an
   * unfinished one opens the trip screen, where Cancel lives.
   */
  finished: boolean;
  /** ISO 8601. When the ride HAPPENED — see `rideHappenedAt`. */
  at: string;
  driverName: string | null;
  pickup: string;
  drop: string;
  /**
   * The two ends as COORDINATES, for "Book again".
   *
   * `pickup`/`drop` above are labels and nothing is ever decided from them — see `TripPoint`. A
   * rebook has to hand home a real point, because `POST /quotes` resolves zones from lat/lng and
   * re-geocoding an address string would be a second guess at a question this row already knows
   * the answer to.
   */
  pickupPoint: TripPoint;
  dropPoint: TripPoint;
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

/**
 * The statuses a customer reads as "Cancelled" — shared with the server through the contracts
 * package, so a filtered page from `GET /customer/bookings?group=CANCELLED` and the badge on each
 * of its rows cannot disagree. See `RIDE_HISTORY_CANCELLED_STATUSES` for why a trip that never
 * found a driver, or expired unpaid, belongs here.
 */
const CANCELLED_STATUSES = new Set<BookingStatus>(RIDE_HISTORY_CANCELLED_STATUSES);
const PRE_DISPATCH_STATUSES = new Set<BookingStatus>(RIDE_HISTORY_PRE_DISPATCH_STATUSES);

/**
 * TAKES THE BOOKING, NOT THE STATUS, because the status alone cannot answer this.
 *
 * `CONFIRMED` is a trip starting in ninety seconds and a trip starting next Tuesday, and calling
 * the second one "Running" is the bug this fixes: a customer saw a ride three days away sitting in
 * their list as though a driver were on the way. `is_scheduled` plus `scheduled_at` are what tell
 * them apart, and both have been on `BookingDto` all along.
 *
 * THE PICKUP TIME DECIDES, NOT THE FLAG. A scheduled booking whose hour has arrived is genuinely
 * running, so `is_scheduled` on its own would leave it labelled "Scheduled" while the driver was
 * already at the door. And a driver assigned days early (ops can pre-assign now) is still a trip
 * for later, which is why `ASSIGNED` counts here too.
 */
export function toRideStatus(booking: Pick<BookingDto, 'status' | 'is_scheduled' | 'scheduled_at'>): RideStatus {
  if (booking.status === 'COMPLETED') return 'COMPLETED';
  if (CANCELLED_STATUSES.has(booking.status)) return 'CANCELLED';

  const notYetDispatched = PRE_DISPATCH_STATUSES.has(booking.status);

  if (booking.is_scheduled && notYetDispatched && Date.parse(booking.scheduled_at) > Date.now()) {
    return 'SCHEDULED';
  }

  return 'RUNNING';
}

/**
 * Whether this booking is over. The list uses it to decide where a row leads: a finished trip to
 * its receipt, a live or upcoming one to the trip screen, which is the only place the customer can
 * cancel from.
 */
export function isRideFinished(status: BookingStatus): boolean {
  return status === 'COMPLETED' || CANCELLED_STATUSES.has(status);
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
 * `adjustments` never edit `fare` — that is invariant B-1 — so a row showing `fare.total` alone
 * would under-report every trip that ran long, and disagree with the detail screen's own invoice,
 * which lists both.
 *
 * READ OFF `payable` RATHER THAN SUMMED FROM `adjustments`, which is what this did. The server now
 * does that arithmetic once, for every client, and two copies of it is how a receipt and a history
 * row come to disagree about one trip. It also picks up an extra day the driver has agreed to on a
 * trip that is still running: the `DAY_EXTENSION` adjustment row carrying it is not written until
 * completion, so summing adjustments saw nothing until the trip was over.
 *
 * PRE-WALLET, deliberately — `payable.total` is the net. The two are different questions and
 * `toRideHistoryRow` below reports both.
 */
export function rideTotalPaise(booking: BookingDto): number {
  const { fare_total, extension_total, waiting_total } = booking.payable;
  return fare_total.amount_paise + extension_total.amount_paise + waiting_total.amount_paise;
}

export function toRideHistoryRow(booking: BookingDto): RideHistoryRow {
  const totalPaise = rideTotalPaise(booking);

  return {
    id: booking.id,
    reference: booking.reference,
    status: toRideStatus(booking),
    finished: isRideFinished(booking.status),
    at: rideHappenedAt(booking),
    driverName: booking.driver?.name ?? null,
    pickup: booking.pickup.address,
    drop: booking.drop.address,
    pickupPoint: {
      lat: booking.pickup.lat,
      lng: booking.pickup.lng,
      address: booking.pickup.address,
    },
    dropPoint: { lat: booking.drop.lat, lng: booking.drop.lng, address: booking.drop.address },
    totalPaise,
    // The server's own figure, not the same subtraction done again here. `payable.total` IS
    // "fare plus extras, less credit, plus carried debt, floored at zero".
    paidPaise: booking.payable.total.amount_paise,
    /*
     * The server's string whenever one describes this figure — which is whenever nothing has been
     * added to the fare. Only a trip that grew needs formatting here, and it is worth avoiding:
     * Hermes ships a reduced ICU on Android, so `₹1,00,000` renders as `₹100,000` on some phones
     * and correctly on others. That is exactly why `toMoney` preformats on the server.
     */
    totalDisplay:
      totalPaise === booking.payable.fare_total.amount_paise
        ? booking.payable.fare_total.amount_display
        : formatPaise(totalPaise),
  };
}


/**
 * "Today" and "This Month" as the instants the server filters on — the start of the customer's
 * local day or month and the start of the next one. Computed here because the server does not
 * know the phone's timezone, and an IST customer's "today" begins at 18:30 UTC the evening before.
 */
export function periodWindow(
  period: 'TODAY' | 'THIS_MONTH',
  now: Date = new Date(),
): { from: string; before: string } {
  const from =
    period === 'TODAY'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth(), 1);
  const before =
    period === 'TODAY'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from: from.toISOString(), before: before.toISOString() };
}
