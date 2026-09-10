/**
 * Rendering conventions. See docs/README.md §Conventions.
 *
 * Money is NOT formatted here. It crosses the wire twice — `amount_paise` to compute with and
 * `amount_display` ("₹1,050") already formatted — so that four clients render identically
 * (packages/contracts/src/http.ts). Formatting paise in the browser reintroduces exactly the
 * drift that pairing exists to prevent. `formatPaise` below is for the one case the server
 * cannot cover: a figure the admin is typing.
 */

const IST = 'Asia/Kolkata';

/** Timestamps are stored UTC and rendered Asia/Kolkata. Always both, never the browser's zone. */
export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: IST,
  }).format(new Date(iso));
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: IST,
  }).format(new Date(iso));
}

/**
 * Today's date in IST as `YYYY-MM-DD` — the form every admin date filter takes.
 *
 * NOT `toISOString().split('T')[0]`, which is the obvious version and is wrong: that yields a UTC
 * date, so between midnight and 05:30 IST it names YESTERDAY. A "bookings today" tile would sit
 * at zero through the early morning and then jump, which reads as an outage rather than a
 * timezone bug — the same trap `format.test.ts` documents for timestamps.
 *
 * `en-CA` is the locale trick: it formats as `2026-09-09` natively, so the parts never need
 * reassembling by hand.
 */
export function istDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: IST,
  }).format(at);
}

/** Metres in, the unit an admin thinks in out. */
export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function formatArea(squareMetres: number): string {
  return `${(squareMetres / 1_000_000).toFixed(1)} km²`;
}

/**
 * Integer paise → a rupee string, for a value the admin is editing rather than one the server
 * sent. Never used to re-render an `amount_display` the API already produced.
 */
export function formatPaise(paise: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 === 0 ? 0 : 2,
  }).format(paise / 100);
}

/** `+919876543210` → `+91 98765 43210`. The API's format is E.164; this is for reading. */
export function formatMobile(e164: string): string {
  const match = /^\+91(\d{5})(\d{5})$/.exec(e164);
  return match === null ? e164 : `+91 ${match[1]} ${match[2]}`;
}
