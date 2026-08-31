/**
 * DOMAIN — the time-of-day surcharge.
 *
 * THE SURCHARGE IS DECIDED BY THE SCHEDULED PICKUP INSTANT, for both products. This closes open
 * question Q8, and the reasoning is worth keeping next to the code because the alternative looks
 * more appealing than it is:
 *
 *   - Testing the whole SERVICE WINDOW for overlap instead — "does the block of time this
 *     booking occupies touch the night band" — is defensible for incity, where a variant's
 *     `includedMinutes` gives a real bounded window. It collapses for outstation, which is a
 *     flat fare for a journey that can run ten hours or three days: almost every outstation trip
 *     would overlap a 22:00–04:00 band, so the surcharge would stop being a surcharge and become
 *     an unconditional line. Applying overlap to one product and the instant to the other means
 *     two rules on one receipt line.
 *
 *   - Recomputing from the ACTUAL start time would let a late driver raise a price the customer
 *     already agreed to, and would break the frozen-fare invariant (B-1) to do it.
 *
 * The cost is real and named here so nobody rediscovers it as a bug: a four-hour incity rental
 * booked for 21:55 runs to 01:55 and pays no night charge. If that is ever worth closing, it is
 * closed with a rule about incity's `includedMinutes`, not by moving to the actual start time.
 *
 * AN IF/ELSE, NEVER A SUM. At most one window can contain an instant, because a cross-key
 * invariant in `settings/domain/setting.invariants.ts` refuses to store two that overlap. That
 * guarantee is what makes this a single lookup; without it the branch order below would silently
 * become a precedence rule.
 */

import type { FareConfig, FareLineCode } from './fare.entity.js';
import { inWindow } from './istClock.js';

export interface Surcharge {
  code: Extract<FareLineCode, 'NIGHT' | 'EARLY_MORNING'>;
  label: string;
  amountPaise: number;
}

/**
 * The surcharge for a pickup instant, or `null` when it falls outside both windows.
 *
 * A charge of `0` is how a surcharge is switched OFF while its window stays meaningful — the
 * registry says so explicitly — so a zero amount returns `null` here rather than an empty line
 * on the receipt.
 */
export function surchargeFor(scheduledAt: Date, config: FareConfig): Surcharge | null {
  if (inWindow(scheduledAt, config.earlyMorningWindow) && config.earlyMorningChargePaise > 0) {
    return {
      code: 'EARLY_MORNING',
      label: 'Early morning charge',
      amountPaise: config.earlyMorningChargePaise,
    };
  }

  if (inWindow(scheduledAt, config.lateNightWindow) && config.lateNightChargePaise > 0) {
    return {
      code: 'NIGHT',
      label: 'Late night charge',
      amountPaise: config.lateNightChargePaise,
    };
  }

  return null;
}
