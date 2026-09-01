/**
 * When the trip happens — the pickup instant, and (for a round trip) the return.
 *
 * TWO FIELDS, ONE OF WHICH IS REAL. `scheduledAt` is a first-class input to `POST /quotes`: the
 * server freezes it on the quote, `isScheduledBooking()` reads it to decide whether a booking
 * waits for its dispatch window, the driver's late fine is measured against it, and the
 * early-morning/late-night surcharge is decided by it. `returnAt` is NOT on the wire anywhere —
 * see `RETURN_IS_LOCAL_ONLY` below.
 *
 * **NULL MEANS NOT CHOSEN YET, NOT "NOW".** Every trip must name a pickup time, so `null` is an
 * incomplete form rather than a value — it disables Continue and is never sent.
 *
 * That is a product rule and it resolves a real inconsistency rather than adding a restriction
 * for its own sake: with `null` meaning "now", a pickup zero minutes away was accepted while one
 * thirty minutes away was refused for being under the hour's lead. The two cannot both be right.
 * The API would take either — it is happy to dispatch immediately — so if immediate bookings are
 * wanted back, this is the decision to revisit, and `MIN_SCHEDULE_LEAD_MINUTES` is the knob.
 */

/**
 * `returnAt` HAS NO BACKEND AND IS NOT SENT. Nothing in `@driverzone/contracts` carries a return
 * time — a round trip is a flat fare that covers the whole journey however many days it runs
 * (`packages.ts`), so the price does not depend on when the customer comes back and no field was
 * ever needed for it.
 *
 * It is collected here so the screen and the flow exist, and it stays in memory on this device.
 * The moment a contract field appears, this constant is the thing to grep for: the picker, the
 * validation and the formatting are all done, and only the wiring is missing.
 */
export const RETURN_IS_LOCAL_ONLY = true;

/**
 * How soon a scheduled pickup may be. Below this it is not a scheduled trip in any useful sense —
 * the server's own threshold for treating a booking as scheduled is 60 minutes
 * (`SCHEDULED_THRESHOLD_MINUTES`), and offering to "schedule" something ten minutes out would
 * produce an immediate booking wearing a scheduled label.
 */
export const MIN_SCHEDULE_LEAD_MINUTES = 60;

/** Far enough for a planned outstation trip, near enough that the wheel is not a year long. */
export const MAX_SCHEDULE_DAYS_AHEAD = 30;

export interface ScheduleBounds {
  minimumDate: Date;
  maximumDate: Date;
}

export function scheduleBounds(now: Date = new Date()): ScheduleBounds {
  return {
    minimumDate: new Date(now.getTime() + MIN_SCHEDULE_LEAD_MINUTES * 60_000),
    maximumDate: new Date(now.getTime() + MAX_SCHEDULE_DAYS_AHEAD * 24 * 60 * 60_000),
  };
}

/** The instant a freshly opened picker should land on: the earliest a customer could pick. */
export function defaultScheduleAnchor(now: Date = new Date()): Date {
  const anchor = scheduleBounds(now).minimumDate;
  // To the next clean five minutes. A wheel that opens on 18:37 invites the customer to leave it
  // there, and a pickup time with a stray minute on it reads as an accident on every screen that
  // shows it afterwards.
  const ms = 5 * 60_000;
  return new Date(Math.ceil(anchor.getTime() / ms) * ms);
}

/**
 * A chosen instant → the words on the row.
 *
 * Takes a REAL DATE, never null: "nothing chosen yet" is not a time and has no formatting, so the
 * two rows say their own thing about it ("Select a time", "Not set"). Folding that into here as a
 * null branch is what let an empty pickup quietly render as the word "Now" and read as a value.
 *
 * Hand-rolled rather than `toLocaleString`: Hermes ships a reduced ICU on Android and date
 * formats are exactly the locale data that goes missing, the same trap `formatPaise` documents.
 * A pickup time rendered one way on a Pixel and another on a Redmi is a support call.
 */
export function formatWhen(at: Date, now: Date = new Date()): string {
  const time = formatTime(at);
  const days = calendarDaysBetween(now, at);

  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  return `${WEEKDAYS[at.getDay()] ?? ''} ${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ''}, ${time}`;
}

/**
 * Why a chosen instant cannot be used, or `null` if it can.
 *
 * Returns PROSE, not a code, because there is no server message to defer to here — this is the
 * app's own rule about its own picker, unlike every unavailability reason on the fare screen.
 */
export function scheduleProblem(at: Date | null, now: Date = new Date()): string | null {
  if (at === null) return null;

  const { minimumDate, maximumDate } = scheduleBounds(now);
  if (at.getTime() < minimumDate.getTime()) {
    return `Pick a time at least ${String(MIN_SCHEDULE_LEAD_MINUTES)} minutes from now.`;
  }
  if (at.getTime() > maximumDate.getTime()) {
    return `We can only book ${String(MAX_SCHEDULE_DAYS_AHEAD)} days ahead.`;
  }
  return null;
}

/**
 * The return leg's own rule: it must come after the pickup.
 *
 * `pickupAt` of `null` means the trip leaves now, so the floor is the current time — a return
 * "before" an immediate departure is the one nonsense this has to catch.
 */
export function returnProblem(
  returnAt: Date | null,
  pickupAt: Date | null,
  now: Date = new Date(),
): string | null {
  if (returnAt === null) return null;

  const departure = pickupAt ?? now;
  if (returnAt.getTime() <= departure.getTime()) {
    return 'The return has to be after the pickup.';
  }
  return null;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** 12-hour with a lowercase suffix — `6:05 pm`. Midnight and noon read as 12, not 0. */
function formatTime(at: Date): string {
  const hours = at.getHours();
  const suffix = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve)}:${String(at.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/**
 * Whole CALENDAR days apart, not elapsed 24-hour periods — the difference decides whether a time
 * reads as "Tomorrow". 11pm tonight to 1am tomorrow is two hours and one calendar day, and
 * calling it "Today" would be wrong on the only axis the customer cares about.
 */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60_000));
}
