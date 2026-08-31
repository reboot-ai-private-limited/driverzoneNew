import { z } from 'zod';
import type { SettingAudience, SettingGroup, SettingUnit } from '@driverzone/contracts';

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
const timeWindow = z
  .object({ start: timeOfDay, end: timeOfDay })
  .refine((w) => w.start !== w.end, {
    message: 'start and end must differ — set the charge to 0 to disable a surcharge',
  });

/** Money. Whole rupees only: `₹2.50` is not representable, deliberately. */
const rupees = z.number().int().min(0);
const minutes = z.number().int().min(0);
const seconds = z.number().int().min(0);
const hours = z.number().int().min(0);

export interface SettingDefinition {
  /** Validates both the stored override and the incoming PATCH value. One rule, not two. */
  schema: z.ZodTypeAny;
  /** In force whenever no row exists. Checked against `schema` by a table test in CI. */
  default: unknown;
  group: SettingGroup;
  label: string;
  unit: SettingUnit;
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
    description: 'Pickups scheduled inside this window attract the late night charge. May cross midnight.',
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
    description: 'One flat, taxable line on every booking, incity and outstation alike.',
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
    description: 'Waiting is free for this long after the driver marks ARRIVED. Charging starts after.',
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
    description: 'Charged when the customer cancels after the driver has arrived. Never below the en-route fee.',
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
    description: 'Debited from the driver who cancels after arriving. Never below the en-route penalty.',
  },

  // ─── Reviews ───────────────────────────────────────────────────────────────────────────────
  'reviews.submission_window_hours': {
    schema: hours,
    default: 24,
    group: 'REVIEWS',
    label: 'Review submission window',
    unit: 'COUNT',
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
