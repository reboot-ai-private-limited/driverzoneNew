import type { BookingDto, BookingStatus } from '@driverzone/contracts';

/**
 * Trip-history rows, adapted from the real `BookingDto`.
 *
 * THE DRIVER'S HALF of what `apps/customer/src/features/rides/rideHistory.ts` does for a customer,
 * and deliberately close to it in shape: the two apps read the same object and should not disagree
 * about which of thirteen statuses counts as "cancelled" or which of six timestamps is "when this
 * happened".
 *
 * WHERE IT DIFFERS, AND WHY. A customer's row is about what they PAID, so it nets wallet credit
 * and debt. A driver's row is about the TRIP — the fare on the meter — because what the driver
 * personally earned from it is a commission split this DTO does not carry. That figure lives in
 * the ledger and is rendered by the Earnings tab, off `GET /driver/wallet`. Deriving a share here
 * from a percentage this app happens to know would put a second, quietly-drifting answer next to
 * the one a driver checks their payout against.
 */

export type TripStatus = 'COMPLETED' | 'CANCELLED' | 'RUNNING';

export interface TripHistoryRow {
  /** The booking's id — what `/trips/[id]` routes on. Never shown. */
  id: string;
  /** `DZ-8F3K2M`. What a driver reads out to support, and what a search matches against. */
  reference: string;
  status: TripStatus;
  /** ISO 8601. When the trip HAPPENED — see `tripHappenedAt`. */
  at: string;
  /** Null when the account never set one — never a placeholder. */
  customerName: string | null;
  pickup: string;
  drop: string;
  isCash: boolean;
  /** Fare plus adjustments, in paise. Sorting needs a number, not a formatted string. */
  totalPaise: number;
  /** The server's own formatting where it is still correct — see `toTripHistoryRow`. */
  totalDisplay: string;
}

/**
 * A trip that never found a driver, or expired unpaid, cannot appear in a DRIVER's history at all
 * — `driverId` was never written to it — so unlike the customer's version this set is only the
 * three real cancellations. They are kept in one place anyway, so a status added to the machine
 * later is an explicit decision here rather than something a negation absorbs.
 */
const CANCELLED_STATUSES = new Set<BookingStatus>([
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  'EXPIRED',
]);

export function toTripStatus(status: BookingStatus): TripStatus {
  if (status === 'COMPLETED') return 'COMPLETED';
  return CANCELLED_STATUSES.has(status) ? 'CANCELLED' : 'RUNNING';
}

/**
 * When the trip happened, for display and for the "Today" / "This month" filters.
 *
 * Prefers what actually occurred over what was planned: a trip completed at 9pm belongs under 9pm,
 * not the 6pm it was scheduled for. `scheduled_at` is the fallback because it is the only
 * timestamp every booking is guaranteed to have.
 */
export function tripHappenedAt(booking: BookingDto): string {
  return booking.timestamps.completed_at ?? booking.timestamps.cancelled_at ?? booking.scheduled_at;
}

/**
 * What the trip came to: the quoted fare plus anything decided afterwards.
 *
 * `adjustments` (waiting time, a late fine) never edit `fare` — invariant B-1 — so a row showing
 * `fare.total` alone would under-report every trip that ran long and disagree with the detail
 * screen's own breakdown, which lists both.
 */
export function tripTotalPaise(booking: BookingDto): number {
  /*
   * READ OFF `payable` RATHER THAN SUMMED FROM `adjustments`, which is what this did. The server
   * does that arithmetic once for every client, and two copies is how a trip row and the trip
   * screen come to disagree. It also picks up an extra day the driver has already agreed to on a
   * trip still under way — the `DAY_EXTENSION` adjustment carrying it is not written until
   * completion, so summing adjustments saw nothing until the trip was over.
   */
  const { fare_total, extension_total, waiting_total } = booking.payable;
  return fare_total.amount_paise + extension_total.amount_paise + waiting_total.amount_paise;
}

/**
 * `70875` → `₹708.75`, `70000` → `₹700`.
 *
 * Money crosses the wire as integer paise and is never floated (docs/README.md); the division
 * happens here, at the last possible moment, purely to render. The same function `earnings.tsx`
 * keeps privately — duplicated rather than shared only because these two screens are the whole
 * population, and a `lib/money.ts` with one caller each is indirection for its own sake.
 */
export function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function toTripHistoryRow(booking: BookingDto): TripHistoryRow {
  const totalPaise = tripTotalPaise(booking);

  return {
    id: booking.id,
    reference: booking.reference,
    status: toTripStatus(booking.status),
    at: tripHappenedAt(booking),
    customerName: booking.customer?.name ?? null,
    pickup: booking.pickup.address,
    drop: booking.drop.address,
    isCash: booking.payment_mode === 'CASH',
    totalPaise,
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

/** Two words at most, uppercased — the avatar fallback when there is no photo to show. */
export function initialsOf(name: string | null): string {
  if (name === null) return '?';
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}
