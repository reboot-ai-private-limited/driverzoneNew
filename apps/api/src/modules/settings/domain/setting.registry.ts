import { z } from 'zod';
import type {
  SettingAudience,
  SettingDisplayScale,
  SettingGroup,
  SettingUnit,
} from '@driverzone/contracts';

/**
 * DOMAIN — THE registry. Every tunable number in the product, in one table.
 *
 * This is the module's load-bearing file. The database stores an override and nothing else: a
 * key's DEFAULT, its validation rule, its unit, its label and who may read it all live here, in
 * code, under review. That has three consequences worth being deliberate about:
 *
 *   1. There is no seed script and there never needs to be a migration. A key with no row is not
 *      missing — it is at its default. Adding a key ships working; removing one leaves at worst
 *      an ignored row.
 *   2. `SettingKey` is a union of literals, so `settings.get('pickup.default_chrage')` does not
 *      compile. A stringly-typed settings table is a typo away from silently reading `undefined`
 *      into a fare.
 *   3. The phase-2 admin UI renders from `group`/`label`/`unit`/`description` rather than a
 *      hand-built form. Adding a setting is this one entry and no UI edit.
 *
 * MONEY IS WHOLE RUPEES. `unit: 'RUPEES'` is not decoration — it is what re-brands the value as
 * `Rupees` in `SettingsSnapshot`, which is what stops a consumer adding it to a paise field. See
 * `./money.ts`.
 */

/** IST wall-clock, 24h. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm, 24-hour');

/**
 * `[start, end)` — inclusive start, exclusive end, and it may wrap midnight (`22:00`–`04:00` is
 * the default late-night window). `start === end` is rejected rather than read as either "empty"
 * or "all day", because those are opposite readings of the same input. To switch a surcharge off,
 * set its CHARGE to 0; the window stays meaningful and the intent is unambiguous.
 */
const timeWindow = z.object({ start: timeOfDay, end: timeOfDay }).refine((w) => w.start !== w.end, {
  message: 'start and end must differ — set the charge to 0 to disable a surcharge',
});

/** Money. Whole rupees only: `₹2.50` is not representable, deliberately. */
const rupees = z.number().int().min(0);
const minutes = z.number().int().min(0);
const seconds = z.number().int().min(0);
const hours = z.number().int().min(0);
const metres = z.number().int().min(0);
const count = z.number().int().min(1);

/** Basis points, the repo-wide way of writing a percentage. `2500` is 25%; `10000` is all of it. */
const bps = z.number().int().min(0).max(10000);

export interface SettingDefinition {
  /** Validates both the stored override and the incoming PATCH value. One rule, not two. */
  schema: z.ZodTypeAny;
  /** In force whenever no row exists. Checked against `schema` by a table test in CI. */
  default: unknown;
  group: SettingGroup;
  label: string;
  unit: SettingUnit;
  /**
   * Optional. Renders the value in a friendlier unit than it is stored in — see
   * `SettingDisplayScale` in contracts. Presentation only: the stored and wire value stays in
   * `unit`, so nothing that READS the setting is affected.
   */
  display?: SettingDisplayScale;
  /** Who may read it. ADMIN is implicit on every key but listed anyway, so the field reads whole. */
  audiences: readonly SettingAudience[];
  /** Shown in the admin form. Written for an ops reader, not for us. */
  description: string;
}

export const SETTING_REGISTRY = {
  // ─── Pickup ────────────────────────────────────────────────────────────────────────────────
  'pickup.default_charge': {
    schema: rupees,
    default: 100,
    group: 'PICKUP',
    label: 'Default pickup charge',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description:
      'Charged when a PAID pickup zone has no charge of its own. A zone with its own amount ignores this.',
  },

  // ─── Time-of-day surcharges ────────────────────────────────────────────────────────────────
  // At most one applies to a booking, chosen by which window contains the scheduled pickup time.
  // The two windows must not overlap — enforced in `setting.invariants.ts`, not here, because it
  // is a rule about the pair and cannot be seen from inside either key.
  'pricing.early_morning_window': {
    schema: timeWindow,
    default: { start: '04:00', end: '06:00' },
    group: 'PRICING',
    label: 'Early morning window',
    unit: 'TIME_WINDOW',
    audiences: ['ADMIN', 'CUSTOMER'],
    description: 'Pickups scheduled inside this window attract the early morning charge.',
  },
  'pricing.early_morning_charge': {
    schema: rupees,
    default: 100,
    group: 'PRICING',
    label: 'Early morning charge',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description: 'Added when the pickup time falls inside the early morning window. 0 disables it.',
  },
  'pricing.late_night_window': {
    schema: timeWindow,
    default: { start: '22:00', end: '04:00' },
    group: 'PRICING',
    label: 'Late night window',
    unit: 'TIME_WINDOW',
    audiences: ['ADMIN', 'CUSTOMER'],
    description:
      'Pickups scheduled inside this window attract the late night charge. May cross midnight.',
  },
  'pricing.late_night_charge': {
    schema: rupees,
    default: 150,
    group: 'PRICING',
    label: 'Late night charge',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description: 'Added when the pickup time falls inside the late night window. 0 disables it.',
  },

  // ─── Insurance ─────────────────────────────────────────────────────────────────────────────
  'pricing.insurance_charge': {
    schema: rupees,
    default: 30,
    group: 'PRICING',
    label: 'Insurance charge',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description:
      'One flat, taxable line, incity and outstation alike. On by default; the customer can opt out per trip.',
  },

  // ─── Tax ───────────────────────────────────────────────────────────────────────────────────
  // Applied to the subtotal and EXCLUDED from the commissionable amount — tax is passed through
  // to the government, not split with the driver (docs/LLD/pricing-and-commission.md).
  //
  // The rate itself is still open question Q13 and is a question for an accountant, not for us.
  // It lives here rather than as a constant so answering it is a settings write and not a
  // deploy; 500 is the placeholder the LLD carries, not advice.
  'pricing.tax_bps': {
    schema: bps,
    default: 500,
    group: 'PRICING',
    label: 'Tax rate',
    unit: 'BPS',
    audiences: ['ADMIN'],
    description:
      'Basis points applied to the fare subtotal. 500 is 5%. Tax is never split with the driver.',
  },

  // ─── Outstation duty policy ────────────────────────────────────────────────────────────────
  // STILL DISPLAY ONLY. Nothing reads this to price, gate or end a trip. Note that the sentence
  // this comment used to carry — "one flat fare for the whole journey however many days it runs"
  // — is no longer true: the band fare is a day rate and `computeOutstationFare` multiplies it.
  // What has not changed is that the HOURS figure has no fare consequence; it states the policy
  // both sides are agreeing to and nothing enforces it.
  'outstation.hours_per_day': {
    schema: hours,
    default: 10,
    group: 'PRICING',
    label: 'Outstation hours per day',
    unit: 'HOURS',
    audiences: ['ADMIN', 'CUSTOMER', 'DRIVER'],
    description:
      'The daily driving hours an outstation booking is sold on. Shown to both sides; nothing enforces it.',
  },

  /*
   * THE CEILING ON A MULTIPLIED FARE, and the reason it exists is arithmetic rather than policy.
   *
   * The band fare is multiplied by the days between pickup and return, and `apps/customer` lets a
   * customer pick a return date up to thirty days out. With no cap, one mis-tapped date is a
   * thirty-times fare — quoted, charged, and dispatched to a driver expecting a month away.
   *
   * A quote past this is REFUSED, never clamped. Clamping would charge fifteen days and still send
   * the driver away for thirty, which is the same bug pointed at the driver instead of the
   * customer. Longer trips are a conversation with ops, not a silent discount.
   */
  'outstation.max_trip_days': {
    schema: count,
    default: 15,
    group: 'PRICING',
    label: 'Maximum outstation trip days',
    unit: 'DAYS',
    audiences: ['ADMIN'],
    description:
      'The longest round trip that can be quoted. The band fare is multiplied by the days, so this bounds what one booking can charge.',
  },

  // ─── Waiting / customer late fee ───────────────────────────────────────────────────────────
  // This clock starts when the driver reaches ARRIVED (docs/LLD/booking-lifecycle.md). It is NOT
  // the overage grace inside the fare, which measures the trip running past its included minutes
  // — a different clock with a different payer.
  'waiting.free_minutes': {
    schema: minutes,
    default: 15,
    group: 'WAITING',
    label: 'Free waiting time',
    unit: 'MINUTES',
    audiences: ['ADMIN', 'CUSTOMER', 'DRIVER'],
    description:
      'Waiting is free for this long after the driver marks ARRIVED. Charging starts after.',
  },
  'waiting.charge_per_minute': {
    schema: rupees,
    default: 2,
    group: 'WAITING',
    label: 'Waiting charge per minute',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description: 'Charged for each minute of waiting beyond the free window.',
  },
  'waiting.max_charge': {
    schema: rupees,
    default: 300,
    group: 'WAITING',
    label: 'Maximum waiting charge',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description: 'Ceiling on the waiting charge for one booking, however long the wait ran.',
  },
  'waiting.no_show_after_minutes': {
    schema: minutes,
    default: 30,
    group: 'WAITING',
    label: 'Mark no-show after',
    unit: 'MINUTES',
    audiences: ['ADMIN', 'CUSTOMER', 'DRIVER'],
    description:
      'The driver may end the booking as a no-show once waiting reaches this. Without it the driver waits indefinitely.',
  },

  // ─── Driver late fine ──────────────────────────────────────────────────────────────────────
  // A ledger debit against the driver, never a line on the customer's fare.
  'driver.late_grace_minutes': {
    schema: minutes,
    default: 10,
    group: 'DRIVER',
    label: 'Driver late grace',
    unit: 'MINUTES',
    audiences: ['ADMIN', 'DRIVER'],
    description: 'A driver arriving within this much of the scheduled time is not counted late.',
  },
  'driver.late_fine': {
    schema: rupees,
    default: 50,
    group: 'DRIVER',
    label: 'Driver late fine',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'DRIVER'],
    description: 'Debited from the driver when they arrive beyond the grace period. 0 disables it.',
  },
  // A driver holding this much of the company's cash stops being offered trips, because the debt
  // is only ever collected out of future earnings. Set low at launch and raised per driver with
  // history (docs/LLD/pricing-and-commission.md §Negative balance policy).
  'driver.max_negative_balance': {
    schema: rupees,
    default: 5000,
    group: 'DRIVER',
    label: 'Maximum driver debt',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'DRIVER'],
    description:
      'A driver owing more than this cannot go on duty until they settle. 0 blocks any debt at all.',
  },

  // ─── Dispatch ──────────────────────────────────────────────────────────────────────────────
  'dispatch.offer_ttl_seconds': {
    schema: seconds,
    default: 45,
    group: 'DISPATCH',
    label: 'Driver ring time',
    unit: 'SECONDS',
    audiences: ['ADMIN', 'DRIVER'],
    description: 'How long a driver has to accept an offer before it moves to the next driver.',
  },
  'dispatch.wave_size': {
    schema: count,
    default: 5,
    group: 'DISPATCH',
    label: 'Drivers rung per wave',
    unit: 'COUNT',
    audiences: ['ADMIN'],
    description: 'How many drivers are offered a booking at once before widening the search.',
  },
  'dispatch.max_waves': {
    schema: count,
    default: 4,
    group: 'DISPATCH',
    label: 'Maximum waves',
    unit: 'COUNT',
    audiences: ['ADMIN'],
    description:
      'How many times the search widens before the booking is given up as NO_DRIVER_FOUND.',
  },
  /**
   * The first wave's search radius. Each later wave DOUBLES it, so the ladder from this default
   * is 3 km → 6 km → 12 km → 24 km.
   *
   * A geometric ladder from one number rather than the literal list in
   * docs/LLD/dispatch-and-assignment.md ([3, 7, 15, 30] km): the shape and the worst case are the
   * same, and a list-valued setting would be the only non-scalar in the registry — it needs its
   * own admin form control, since every other unit renders as one number input. When per-wave
   * radii genuinely need to differ, that control is the thing to build.
   */
  'dispatch.wave_base_radius_m': {
    schema: metres,
    default: 3000,
    group: 'DISPATCH',
    label: 'First wave radius',
    unit: 'METRES',
    /*
     * STORED IN METRES, SHOWN IN KILOMETRES. The dispatch code compares a radius against a
     * distance and wants metres; an admin deciding how far the first wave should reach thinks in
     * kilometres, and the LLD writes the ladder that way too ([3, 7, 15, 30] km). `3000` in a box
     * is a number that has to be converted in the reader's head every time.
     *
     * The other two METRES keys below deliberately do NOT get this — 500 m shown as "0.5 km" is
     * worse than what it says now, which is why the scale is per key rather than per unit.
     */
    display: { unit: 'KILOMETRES', factor: 1000, decimals: 1 },
    audiences: ['ADMIN'],
    description:
      'How far the first wave looks for a driver. Each subsequent wave doubles this distance.',
  },
  'dispatch.scheduled_lead_minutes': {
    schema: minutes,
    default: 90,
    group: 'DISPATCH',
    label: 'Scheduled booking lead time',
    unit: 'MINUTES',
    audiences: ['ADMIN'],
    description:
      'How far ahead of its pickup time a scheduled booking starts looking for a driver.',
  },

  // ─── Location gates ────────────────────────────────────────────────────────────────────────
  // Two radii that read alike and behave deliberately differently.
  //
  // ARRIVAL BLOCKS. Reaching ARRIVED starts the waiting-charge clock, so a driver who can mark
  // it from the highway is a driver who can bill a customer for time they were not waiting.
  //
  // START ONLY WARNS, and that asymmetry is the point: by then the customer is in the car, and a
  // hard block on a drifting GPS strands a trip that is genuinely happening. The override is
  // recorded in bookingEvents.metadata instead — a driver with many of them is worth a look.
  'dispatch.arrival_radius_m': {
    schema: metres,
    default: 500,
    group: 'DISPATCH',
    label: 'Arrival radius',
    unit: 'METRES',
    audiences: ['ADMIN', 'DRIVER'],
    description:
      'How close a driver must be to the pickup point to mark themselves arrived. Beyond it the button is refused.',
  },
  'dispatch.start_warn_radius_m': {
    schema: metres,
    default: 500,
    group: 'DISPATCH',
    label: 'Trip start warning radius',
    unit: 'METRES',
    audiences: ['ADMIN', 'DRIVER'],
    description:
      'Starting a trip further than this from the pickup point is allowed, but recorded against the driver.',
  },

  // ─── Cancellation ──────────────────────────────────────────────────────────────────────────
  // Mirrors the ladder in docs/LLD/booking-lifecycle.md §Cancellation policy. There is no hard
  // cutoff after which cancelling is refused: a customer who cannot cancel no-shows instead,
  // which costs a driver's time AND a support ticket. The fee is the deterrent.
  'cancellation.free_window_seconds': {
    schema: seconds,
    default: 300,
    group: 'CANCELLATION',
    label: 'Free cancellation window',
    unit: 'SECONDS',
    audiences: ['ADMIN', 'CUSTOMER'],
    description: 'A booking may be cancelled free for this long after it is confirmed.',
  },
  'cancellation.scheduled_free_until_minutes_before': {
    schema: minutes,
    default: 60,
    group: 'CANCELLATION',
    label: 'Scheduled bookings free until',
    unit: 'MINUTES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description:
      'A booking scheduled for later is free to cancel until this many minutes before its pickup time.',
  },
  'cancellation.customer_fee_en_route': {
    schema: rupees,
    default: 50,
    group: 'CANCELLATION',
    label: 'Customer fee — driver en route',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description: 'Charged when the customer cancels after the driver has set off.',
  },
  'cancellation.customer_fee_arrived': {
    schema: rupees,
    default: 100,
    group: 'CANCELLATION',
    label: 'Customer fee — driver arrived',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'CUSTOMER'],
    description:
      'Charged when the customer cancels after the driver has arrived. Never below the en-route fee.',
  },
  'cancellation.driver_penalty_en_route': {
    schema: rupees,
    default: 50,
    group: 'CANCELLATION',
    label: 'Driver penalty — en route',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'DRIVER'],
    description: 'Debited from the driver who cancels after setting off. 0 disables it.',
  },
  'cancellation.driver_penalty_arrived': {
    schema: rupees,
    default: 100,
    group: 'CANCELLATION',
    label: 'Driver penalty — arrived',
    unit: 'RUPEES',
    audiences: ['ADMIN', 'DRIVER'],
    description:
      'Debited from the driver who cancels after arriving. Never below the en-route penalty.',
  },

  // ─── Reviews ─────────────────────────────────────────────────────────────────
  // Does double duty (docs/LLD/reviews.md). It is the deadline a `/rate` POST is refused past,
  // and it is also how long a review stays BLIND — unpublished, invisible in either average —
  // when only one side has rated. Shortening it publishes sooner and gives the second party less
  // time; the two cannot be tuned apart.
  'reviews.submission_window_hours': {
    schema: hours,
    default: 24,
    group: 'REVIEWS',
    label: 'Review submission window',
    unit: 'HOURS',
    audiences: ['ADMIN', 'CUSTOMER', 'DRIVER'],
    description: 'Hours after a trip completes during which a review can be submitted.',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_REGISTRY;

export const SETTING_KEYS = Object.keys(SETTING_REGISTRY) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_REGISTRY, key);
}

/**
 * Group display order and titles. Here rather than in the UI so that adding a group is still a
 * one-file change, and so the API's own ordering is the one the admin panel shows.
 */
export const SETTING_GROUP_ORDER = [
  'PICKUP',
  'PRICING',
  'WAITING',
  'DRIVER',
  'DISPATCH',
  'CANCELLATION',
  'REVIEWS',
] as const satisfies readonly SettingGroup[];

export const SETTING_GROUP_LABELS: Record<SettingGroup, string> = {
  PICKUP: 'Pickup',
  PRICING: 'Fare & surcharges',
  WAITING: 'Waiting time',
  DRIVER: 'Driver conduct',
  DISPATCH: 'Dispatch',
  CANCELLATION: 'Cancellation',
  REVIEWS: 'Trip reviews',
};
