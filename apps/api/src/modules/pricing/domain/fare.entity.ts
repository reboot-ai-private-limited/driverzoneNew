/**
 * DOMAIN — the shape of a fare, and the configuration it is computed against.
 *
 * MONEY IS INTEGER PAISE, without exception (docs/LLD/database-schema.md §Conventions).
 * `globalSettings` is the one place money is whole rupees, and the conversion happens in the
 * CALLER, not here: `pricing` and `settings` are both tier 0 and same-tier imports are forbidden,
 * so this module cannot see `Rupees` or `rupeesToPaise()` even if it wanted to. That constraint
 * lands in the right place — `FareConfig` below is plain paise, and a caller assembling it from
 * a settings snapshot has exactly one line per field where the unit is visible and checkable.
 */

import type { Direction, Terrain, TimeWindow } from '@driverzone/contracts';

/**
 * Every line a fare can carry today. Codes, not labels: the label is prose that will be
 * rewritten and translated, the code is what a receipt eight weeks old is parsed by.
 *
 * `NIGHT` and `EARLY_MORNING` are separate codes for one mutually exclusive charge. One code
 * with a varying label would make "how much did we take in late-night surcharges last month" a
 * string match on the label.
 */
export const FARE_LINE_CODES = [
  'BASE',
  'RETURN_DRIVER_ALLOWANCE',
  'PICKUP_FEE',
  'NIGHT',
  'EARLY_MORNING',
  'INSURANCE',
] as const;
export type FareLineCode = (typeof FARE_LINE_CODES)[number];

export interface FareLine {
  code: FareLineCode;
  /** Shown to the customer as-is. Built here so the receipt and the quote cannot disagree. */
  label: string;
  amountPaise: number;
}

/** Frozen onto the booking at confirmation. Never recomputed, never edited (invariant B-1). */
export interface FareSplit {
  /** The subtotal. Tax is EXCLUDED — it is passed to the government, not shared with the driver. */
  commissionablePaise: number;
  /**
   * What the PACKAGE said the driver is paid — already multiplied by the days on outstation.
   *
   * Kept alongside `driverPaise` rather than replaced by it, because the two differ exactly when
   * `splitFare`'s clamp fired: the fare did not cover what the package promised. That makes a
   * misconfigured package visible in stored data, which is the only way it is visible at all —
   * `pricing` is pure and does not log.
   */
  driverAmountPaise: number;
  /** What the driver is actually paid. Equals `driverAmountPaise` unless the fare could not cover it. */
  driverPaise: number;
  /**
   * The remainder, and derived rather than configured. Storing both sides independently is what
   * let an admin form save 75% and 20% and leave 5% of every trip in nobody's column.
   */
  companyPaise: number;
}

/**
 * The day rate this fare was built from, kept so another day can be bought later.
 *
 * WHY IT HAS TO BE STORED. Everything else here is already MULTIPLIED — the BASE line is
 * `farePaise × days` and `split.driverAmountPaise` likewise — so a frozen snapshot cannot be
 * divided back into a day without knowing the count, and integer rounding means it could not be
 * divided reliably even then. A booking that wants to buy one more day needs the price of one
 * day exactly as it was agreed, and this is it.
 *
 * PER DAY, NOT MULTIPLIED. Both figures here are the single-day rate; `days` says how many the
 * fare above actually charged for.
 */
export interface FareDayRate {
  /** IST calendar days this fare charged for, both ends included. */
  days: number;
  /** The band's fare for ONE day. */
  farePaise: number;
  /** What the driver is paid for ONE day. */
  driverAmountPaise: number;
}

export interface FareBreakdown {
  serviceType: 'INCITY' | 'OUTSTATION';
  /** Only the lines that are actually non-zero, except BASE. A ₹0 row on a receipt is noise. */
  lines: FareLine[];
  subtotalPaise: number;
  taxBps: number;
  taxPaise: number;
  totalPaise: number;
  split: FareSplit;
  /**
   * `null` ON INCITY, and that is not an omission. An hourly package has no day to sell — its
   * unit is the variant ("3 Hours"), and inventing a day rate for it would be a number nobody
   * agreed to. It is also `undefined` on every fare computed before day extensions existed, which
   * reads the same way: that booking cannot be extended, and the endpoint says so rather than
   * guessing a price.
   */
  perDay: FareDayRate | null;
}

/**
 * Everything the fare formulas read that is not on the package. Assembled by the caller from a
 * settings snapshot, with every rupee value already through `rupeesToPaise()`.
 */
export interface FareConfig {
  earlyMorningWindow: TimeWindow;
  earlyMorningChargePaise: number;
  lateNightWindow: TimeWindow;
  lateNightChargePaise: number;
  insuranceChargePaise: number;
  taxBps: number;
}

/**
 * The pickup point's contribution. `PAID` zones may carry their own charge; the settings default
 * is the number ops actually tunes and the per-zone override exists for the day a second paid
 * zone needs a different figure. A `FREE` zone adds no line at all.
 */
export interface PickupZoneFare {
  name: string;
  chargeType: 'FREE' | 'PAID';
  /** The zone's own override in paise, or null to fall back to the settings default. */
  chargePaise: number | null;
  defaultChargePaise: number;
}

export interface FlatFareInput {
  variantLabel: string;
  baseFarePaise: number;
  driverAmountPaise: number;
  pickupZone: PickupZoneFare;
  /** The scheduled pickup instant. The surcharge is decided from this and nothing else. */
  scheduledAt: Date;
}

export type IncityFareInput = FlatFareInput;

export interface OutstationFareInput {
  packageName: string;
  terrain: Terrain;
  direction: Direction;
  /**
   * The band's fare for this direction. Flat across the band — 72 km and 98 km both pay the
   * 70–100 fare — and never null, because a band that cannot sell the direction did not match.
   */
  farePaise: number;
  /**
   * Forward driving days the journey covers (`1` for a same-day or short trip).
   *
   * The band fare is a DAY RATE, so this multiplies it. For round trips, derived from calendar days;
   * for one-way trips, derived from travel duration via `oneWayDrivingDays`.
   */
  days: number;
  /**
   * Extra return days paid entirely to the driver (at `driverAmountPaise`) to compensate for
   * returning with an empty seat on long one-way outstation trips. `0` or undefined when none applies.
   */
  extraDays?: number;
  driverAmountPaise: number;
  pickupZone: PickupZoneFare;
  scheduledAt: Date;
}
