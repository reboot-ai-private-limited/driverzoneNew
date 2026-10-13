import type { ServiceType } from '@driverzone/contracts';

/**
 * When the trip happens — the pickup instant, and (for a round trip) the return.
 *
 * TWO FIELDS, ONE OF WHICH IS REAL. `scheduledAt` is a first-class input to `POST /quotes`: the
 * server freezes it on the quote, `isScheduledBooking()` reads it to decide whether a booking
 * waits for its dispatch window, the driver's late fine is measured against it, and the
 * early-morning/late-night surcharge is decided by it. `returnAt` is NOT on the wire anywhere —
 * see `RETURN_IS_LOCAL_ONLY` below.
 *
 * **NULL MEANS NOW ON AN IN-CITY TRIP, AND "NOT CHOSEN YET" ON AN OUTSTATION ONE.** The same
 * absence is a value on one product and an incomplete form on the other, and `allowsInstant`
 * below is the whole of that distinction.
 *
 * The split resolves an inconsistency rather than adding one. Null used to mean "not chosen" on
 * every product, so the app refused a pickup zero minutes away and made somebody standing beside
 * their own car wait an hour to be collected. In-city is exactly the product that breaks on:
 * short, unplanned, wanted now. Outstation takes a driver out of town for a day or more and is
 * planned by its nature, so it keeps the lead time and keeps naming its hour.
 *
 * THE API TOOK EITHER SHAPE ALL ALONG. `scheduledAt` is optional on `POST /quotes` and an absent
 * field means "the server decides", so a device with a wrong clock still cannot book into the
 * past, and the server already treats anything under its own 60-minute threshold as an immediate
 * booking that dispatches at once. Nothing had to change behind the wire for this.
 */

/**
 * `returnAt` IS PART OF THE PRICE, and is sent.
 *
 * This used to be `RETURN_IS_LOCAL_ONLY = true`: the return date was collected, validated and
 * displayed, and never left the device, because a round trip was one flat fare "however many days
 * it runs". The consequence was a customer picking a return three days out and being quoted the
 * same-day price, with the driver away three days for one day's money.
 *
 * The band fare is now a day rate. `CreateQuoteRequest.returnAt` carries this instant, the server
 * counts IST calendar days from the pickup and multiplies, and the fare card's base line names the
 * count. A same-day return spans one day and prices exactly as it always did.
 */

/**
 * Which products may leave NOW, with no pickup time named.
 *
 * IN-CITY ONLY — and `null`, which is "the quote has not answered yet", counts as in-city here on
 * purpose. The service type is the server's verdict and arrives with the fare, so until then the
 * Pickup row has to show *something*. Offering "Now" and withdrawing it on an outstation answer
 * shows the easier case first and corrects it on evidence; the other order asks every in-city
 * customer for a time they never needed to give. It is the trade `TripOptions` already makes with
 * the one-way/round-trip toggle, for the same reason.
 *
 * Continue cannot be pressed during that window anyway — a quote is in flight and `pricing` holds
 * the button down — so the optimistic value is never what a booking gets made on.
 */
export function allowsInstant(serviceType: ServiceType | null): boolean {
  return serviceType !== 'OUTSTATION';
}

/**
 * How soon a pickup may be, per product.
 *
 * **IN-CITY HAS NO FLOOR, AND THAT IS THE POINT OF THE PRODUCT.** "Now, or an hour out" was the
 * rule here, on the reasoning that a pickup inside the hour is not a scheduled trip in any useful
 * sense. On a real phone that reasoning collapsed: the Pickup row is the obvious control, a
 * customer on a fifteen-minute cross-town trip taps it and asks for twenty minutes' time, and the
 * app refused with "Pick a time at least 60 minutes from now" — on the one product that exists to
 * be immediate. A dead end reached by doing the natural thing is worse than no picker at all.
 *
 * The band that floor was protecting is now closed at the other end instead: the server's
 * `SCHEDULED_THRESHOLD_MINUTES` was 60, which made a 2:35 pickup booked at 2:05 an *immediate*
 * booking wearing a scheduled label — rung at once, driver waiting twenty minutes, and outside
 * the waiting-charge exemption that protects scheduled trips. It is 0 now, so any future pickup
 * is genuinely scheduled and the two sides agree at every distance.
 *
 * OUTSTATION KEEPS ITS HOUR. That trip takes a driver out of town for a day or more; it is
 * planned by its nature, and an hour's notice is the least that makes it plannable.
 */
export const INCITY_MIN_LEAD_MINUTES = 0;
export const OUTSTATION_MIN_LEAD_MINUTES = 60;

export function minLeadMinutesFor(serviceType: ServiceType | null): number {
  return allowsInstant(serviceType) ? INCITY_MIN_LEAD_MINUTES : OUTSTATION_MIN_LEAD_MINUTES;
}

/** Far enough for a planned outstation trip, near enough that the wheel is not a year long. */
export const MAX_SCHEDULE_DAYS_AHEAD = 30;

export interface ScheduleBounds {
  minimumDate: Date;
  maximumDate: Date;
}

export function scheduleBounds(
  serviceType: ServiceType | null = null,
  now: Date = new Date(),
): ScheduleBounds {
  return {
    minimumDate: new Date(now.getTime() + minLeadMinutesFor(serviceType) * 60_000),
    maximumDate: new Date(now.getTime() + MAX_SCHEDULE_DAYS_AHEAD * 24 * 60 * 60_000),
  };
}

/**
 * The instant a freshly opened picker should land on: the earliest a customer could pick.
 *
 * ROUNDED UP TO A CLEAN FIVE MINUTES — a wheel that opens on 18:37 invites the customer to leave
 * it there, and a pickup time with a stray minute on it reads as an accident on every screen that
 * shows it afterwards. In-city rounds up from NOW, so the picker opens a few minutes ahead rather
 * than on an instant that has passed by the time they press OK.
 */
export function defaultScheduleAnchor(
  serviceType: ServiceType | null = null,
  now: Date = new Date(),
): Date {
  const anchor = scheduleBounds(serviceType, now).minimumDate;
  const ms = 5 * 60_000;
  return new Date(Math.ceil(anchor.getTime() / ms) * ms);
}

/**
 * A chosen instant → the words on the row.
 *
 * Takes a REAL DATE, never null: an absent pickup means different things on different products —
 * "Now" on an in-city trip, "Select a time" on an outstation one, "Not set" on a return leg — and
 * none of the three is a formatted date. Each row says its own thing about it (see
 * `TripOptions`) rather than this growing a null branch that would have to know which product it
 * was rendering for.
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
 *
 * AN UNSET TIME IS NEVER A PROBLEM, on either product. In-city it is the value "now"; outstation
 * it is a field nobody has filled in yet, which the Pickup row states in muted type and
 * `tripIncomplete` keeps Continue dead for. Red is for a choice that was made and cannot be used,
 * not for a step the customer has not reached.
 *
 * IT TAKES THE SERVICE TYPE because the floor is per-product now — in-city has none, so the only
 * complaint it can make about an in-city pickup is that the time has already passed.
 */
export function scheduleProblem(
  at: Date | null,
  serviceType: ServiceType | null = null,
  now: Date = new Date(),
): string | null {
  if (at === null) return null;

  const { minimumDate, maximumDate } = scheduleBounds(serviceType, now);
  if (at.getTime() < minimumDate.getTime()) {
    const lead = minLeadMinutesFor(serviceType);
    // With no floor the only way to be under it is to be in the past, and "at least 0 minutes
    // from now" is not a sentence anybody should be shown.
    return lead === 0
      ? 'That time has already passed. Pick a later one.'
      : `Pick a time at least ${String(lead)} minutes from now.`;
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

/**
 * 12-hour with a lowercase suffix — `6:05 pm`. Midnight and noon read as 12, not 0.
 *
 * Exported on its own: the trip screen's progress timeline wants a bare time against each
 * milestone (`Arrived · 6:05 pm`), not `formatWhen`'s "Today, …" framing, which reads oddly
 * repeated down a list of things that mostly happened minutes apart on the same day.
 */
export function formatTime(at: Date): string {
  const hours = at.getHours();
  const suffix = hours < 12 ? 'am' : 'pm';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve)}:${String(at.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/**
 * How long something took — `1h 20m`, `45m`, `3h`. Minutes rounded, never negative.
 *
 * Shared by the live trip screen and the ride receipt, so "Duration" reads the same on both.
 */
export function formatDuration(from: Date, to: Date): string {
  const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
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
