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
  driverCommissionBps: number;
  driverPaise: number;
  /**
   * The remainder, and derived rather than configured. Storing both sides independently is what
   * let an admin form save 75% and 20% and leave 5% of every trip in nobody's column.
   */
  companyPaise: number;
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

export interface IncityFareInput {
  variantLabel: string;
  baseFarePaise: number;
  driverCommissionBps: number;
  pickupZone: PickupZoneFare;
  /** The scheduled pickup instant. The surcharge is decided from this and nothing else. */
  scheduledAt: Date;
}

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
   * IST calendar days the journey covers, both ends included — `1` for a same-day trip.
   *
   * The band fare is a DAY RATE, so this multiplies it. One-way trips and incity are always `1`:
   * neither has a return leg for a duration to be measured against.
   */
  days: number;
  driverCommissionBps: number;
  pickupZone: PickupZoneFare;
  scheduledAt: Date;
}
