/**
 * Rendering conventions for the booking screen ONLY.
 *
 * `formatDate` and `formatMobile` in `@/lib/format` are SHARED — the customer and driver
 * directories both render dates and phone numbers with those, and changing either one to suit
 * this screen would silently change every other screen that calls them too. These two exist
 * because the booking table wants a compact date (day, short month, two-digit year) and a
 * number without its country code, and neither of those is true anywhere else in the panel.
 */

const IST = 'Asia/Kolkata';

/**
 * `2026-09-04T16:05:00.000Z` → `04 Sep 26`.
 *
 * Two-digit year, deliberately: the table already carries a "Date & time" column next to seven
 * other columns, and "2026" versus "26" is four characters per row that buy nothing — an admin
 * looking at today's bookings already knows what year it is.
 */
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
