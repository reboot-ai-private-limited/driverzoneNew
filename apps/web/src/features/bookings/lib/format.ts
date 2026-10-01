/**
 * Rendering conventions for the booking screen ONLY.
 *
 * `formatDate` and `formatMobile` in `@/lib/format` are SHARED — the customer and driver
 * directories both render dates and phone numbers with those, and changing either one to suit
 * this screen would silently change every other screen that calls them too. These two exist
 * because the booking table wants a compact date (day, short month, two-digit year) and a
 * number without its country code, and neither of those is true anywhere else in the panel.
 */

import type { BookingDto } from '@driverzone/contracts';

const IST = 'Asia/Kolkata';

/**
 * `2026-09-04T16:05:00.000Z` → `04 Sep 26`.
 *
 * Two-digit year, deliberately: the table already carries a "Date & time" column next to seven
 * other columns, and "2026" versus "26" is four characters per row that buy nothing — an admin
 * looking at today's bookings already knows what year it is.
 */
/** `200` → `3h 20m`, `45` → `45m`, `180` → `3h`. */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest}m`;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/**
 * The duration line on the booking page, at every stage of the trip — never a bare "not
 * available" on the bookings that most need explaining.
 *
 *   - finished: what it actually took, `started_at` → `completed_at`.
 *   - running: how long it has been going, so support can see a 3-hour rental at hour four.
 *   - not started: what was BOOKED — the in-city package's included time. An outstation trip is
 *     a package with no hours figure (`included_minutes` is null), so it says so instead.
 *   - never started and over (cancelled, no driver, expired): there was no trip to time.
 */
export function tripDurationText(
  booking: Pick<BookingDto, 'status' | 'service_type' | 'included_minutes' | 'timestamps'>,
  now: Date = new Date(),
): string {
  const { started_at, completed_at } = booking.timestamps;

  if (started_at !== null && completed_at !== null) {
    return `${formatMinutes((Date.parse(completed_at) - Date.parse(started_at)) / 60_000)} taken`;
  }
  if (started_at !== null && booking.status === 'STARTED') {
    return `Running ${formatMinutes((now.getTime() - Date.parse(started_at)) / 60_000)}`;
  }
  if (started_at === null && TRIP_ENDED_UNSTARTED.has(booking.status)) {
    return 'Trip did not start';
  }
  if (booking.included_minutes !== null) {
    return `${formatMinutes(booking.included_minutes)} booked`;
  }
  return booking.service_type === 'OUTSTATION' ? 'Outstation package' : 'Not started yet';
}

const TRIP_ENDED_UNSTARTED = new Set<BookingDto['status']>([
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'NO_DRIVER_FOUND',
  'EXPIRED',
]);

/** In-city trips are priced on time, not distance, so no distance is frozen onto them. */
export function tripDistanceText(
  booking: Pick<BookingDto, 'distance_km' | 'service_type'>,
): string {
  if (booking.distance_km !== null) return `${booking.distance_km.toFixed(1)} km`;
  return booking.service_type === 'INCITY' ? 'In-city — priced by time' : 'Distance not recorded';
}

export function formatBookingDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: IST,
  }).format(new Date(iso));
}

/**
 * `+919876543210` → `9876543210`. No country code and no internal space: every number in this
 * database is Indian (E.164 with a `+91` prefix — see `formatMobile`), so the `+91` identifies
 * nothing on a screen where every row has the same one, and the ten digits read as one number
 * rather than two five-digit halves — which is also what a search box or a dialer expects pasted.
 */
export function formatBookingMobile(e164: string): string {
  const match = /^\+91(\d{10})$/.exec(e164);
  // The `?? e164` never actually fires: a regex with one group that matched has that group
  // populated. It is here because `match[1]`'s type is `string | undefined` regardless — the
  // indexed-access rule cannot see that this particular pattern guarantees it.
  return match === null ? e164 : (match[1] ?? e164);
}
