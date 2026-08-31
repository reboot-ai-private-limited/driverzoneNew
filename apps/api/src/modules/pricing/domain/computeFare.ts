/**
 * DOMAIN — the fare formulas. Pure: rates and instants in, a `FareBreakdown` out.
 *
 * Both products compute identically once the base is chosen, and that is deliberate — the pickup
 * fee, the time-of-day surcharge, insurance, tax and the split are one rule shared by both, not
 * two rules that happen to agree today.
 */

import type {
  FareBreakdown,
  FareConfig,
  FareLine,
  IncityFareInput,
  OutstationFareInput,
  PickupZoneFare,
} from './fare.entity.js';
import { assertFareReconciles, splitFare } from './splitFare.js';
import { surchargeFor } from './surcharge.js';

const PAISE_PER_RUPEE = 100;

/** Round once, at the end, to the nearest whole rupee. */
function roundToRupee(paise: number): number {
  return Math.round(paise / PAISE_PER_RUPEE) * PAISE_PER_RUPEE;
}

/**
 * The pickup point's line, or `null` for a `FREE` zone — which adds nothing and gets no row. A
 * zero-value fee line on a receipt invites the question "why am I being charged ₹0".
 */
function pickupLine(zone: PickupZoneFare): FareLine | null {
  if (zone.chargeType !== 'PAID') return null;
  const amountPaise = zone.chargePaise ?? zone.defaultChargePaise;
  if (amountPaise <= 0) return null;
  return { code: 'PICKUP_FEE', label: `Pickup charge (${zone.name})`, amountPaise };
}

/**
 * Everything after the base fare — identical for incity and outstation.
 *
 * TAX ABSORBS THE ROUNDING, and this is the one place the LLD's own arithmetic needed a decision
 * rather than a transcription. It says `total = roundToRupee(subtotal + tax)` and separately
 * asserts `driver + company + tax === total`. Those cannot both hold as written: the driver and
 * company shares sum to the subtotal exactly, so the assertion demands `subtotal + tax === total`
 * while the rounding is free to move the total by up to 99 paise.
 *
 * Rounding the total and then deriving tax as the remainder satisfies both. The alternatives are
 * worse: rounding the subtotal instead changes what the driver is owed for a presentation
 * concern, and dropping the rounding leaves customers paying ₹1,049.37. Tax moves by under a
 * rupee, and it is the only line here that is a pass-through rather than someone's money.
 */
function assemble(
  serviceType: 'INCITY' | 'OUTSTATION',
  baseLine: FareLine,
  input: { pickupZone: PickupZoneFare; scheduledAt: Date; driverCommissionBps: number },
  config: FareConfig,
): FareBreakdown {
  const lines: FareLine[] = [baseLine];

  const pickup = pickupLine(input.pickupZone);
  if (pickup !== null) lines.push(pickup);

  const surcharge = surchargeFor(input.scheduledAt, config);
  if (surcharge !== null) {
    lines.push({ code: surcharge.code, label: surcharge.label, amountPaise: surcharge.amountPaise });
  }

  if (config.insuranceChargePaise > 0) {
    lines.push({ code: 'INSURANCE', label: 'Insurance', amountPaise: config.insuranceChargePaise });
  }

  const subtotalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);
  const totalPaise = roundToRupee(subtotalPaise + Math.round((subtotalPaise * config.taxBps) / 10000));
  const taxPaise = totalPaise - subtotalPaise;

  const split = splitFare(subtotalPaise, input.driverCommissionBps);
  assertFareReconciles(split, taxPaise, totalPaise);

  return {
    serviceType,
    lines,
    subtotalPaise,
    taxBps: config.taxBps,
    taxPaise,
    totalPaise,
    split,
  };
}

/**
 * An incity fare is the variant's price plus the shared lines. There is no overage term and no
 * recompute at completion: the quoted total IS the total, and a 3-hour booking that runs 3h 40m
 * costs what the customer was told (open question Q2, closed 2026-08-28). `includedMinutes` is
 * still what the customer bought and what tells the driver when they are released — it just has
 * no fare consequence when it is exceeded.
 */
export function computeIncityFare(input: IncityFareInput, config: FareConfig): FareBreakdown {
  return assemble(
    'INCITY',
    { code: 'BASE', label: input.variantLabel, amountPaise: input.baseFarePaise },
    input,
    config,
  );
}

/**
 * An outstation fare is the band's flat price for the direction, plus the same shared lines.
 *
 * FLAT ACROSS THE BAND — 72 km and 98 km both pay the 70–100 fare — and flat across the whole
 * journey however many days it runs. There is no per-km term and no per-day term to add here;
 * `outstation.hours_per_day` is a policy shown to both sides and read by nothing in this file.
 */
export function computeOutstationFare(
  input: OutstationFareInput,
  config: FareConfig,
): FareBreakdown {
  const label = input.direction === 'ROUND_TRIP' ? 'Return journey' : 'One way';
  return assemble(
    'OUTSTATION',
    { code: 'BASE', label: `${input.packageName} — ${label}`, amountPaise: input.farePaise },
    input,
    config,
  );
}
