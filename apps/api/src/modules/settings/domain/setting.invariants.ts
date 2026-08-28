import type { TimeWindow } from '@driverzone/contracts';
import { rupeesValue } from './money.js';
import type { SettingsSnapshot } from './setting.entity.js';

/**
 * DOMAIN — the rules no single key can see.
 *
 * Each value in the registry validates itself. These are the constraints that only exist between
 * keys, and they are checked against the MERGED snapshot a write would produce rather than
 * against the patch — otherwise a perfectly valid single edit ("move the early morning window to
 * 03:00") still lands the system in a state where two surcharges claim the same hour and the
 * fare engine has to pick one arbitrarily.
 *
 * Pure, and exported for the tests: a rule that only runs behind an HTTP handler is a rule that
 * gets exercised once.
 */

export interface InvariantViolation {
  /** The keys the reader has to look at to understand the failure — both sides of the rule. */
  keys: string[];
  message: string;
}

const MINUTES_IN_DAY = 1440;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/**
 * A window as one or two half-open `[start, end)` intervals on a 24-hour line. A window that
 * wraps midnight (`22:00`–`04:00`) becomes two, which is what lets a plain overlap test work
 * without any circular arithmetic at the comparison site.
 */
function toIntervals(window: TimeWindow): Array<[number, number]> {
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  return end > start ? [[start, end]] : [[start, MINUTES_IN_DAY], [0, end]];
}

function overlaps(a: TimeWindow, b: TimeWindow): boolean {
  return toIntervals(a).some(([aStart, aEnd]) =>
    toIntervals(b).some(([bStart, bEnd]) => aStart < bEnd && bStart < aEnd),
  );
}

export function checkInvariants(snapshot: SettingsSnapshot): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // At most one time-of-day surcharge may apply to a booking. Overlapping windows would make
  // that a coin flip decided by whichever branch the fare engine happens to test first.
  if (overlaps(snapshot['pricing.early_morning_window'], snapshot['pricing.late_night_window'])) {
    violations.push({
      keys: ['pricing.early_morning_window', 'pricing.late_night_window'],
      message:
        'The early morning and late night windows overlap. A booking must fall in at most one surcharge window.',
    });
  }

  // Without this the no-show timer can fire while waiting is still free, so the driver leaves
  // before a single chargeable minute has run.
  if (snapshot['waiting.no_show_after_minutes'] <= snapshot['waiting.free_minutes']) {
    violations.push({
      keys: ['waiting.no_show_after_minutes', 'waiting.free_minutes'],
      message: 'No-show must be later than the free waiting window, otherwise waiting is never chargeable.',
    });
  }

  // Both ladders must step up. A later cancellation costing less than an earlier one rewards
  // waiting until the driver is at the door.
  // `rupeesValue` on both sides: `Rupees` is opaque precisely so it cannot be compared against a
  // paise figure by accident, and the cost of that is unwrapping it here, where both sides are
  // known to be rupees.
  if (
    rupeesValue(snapshot['cancellation.customer_fee_arrived']) <
    rupeesValue(snapshot['cancellation.customer_fee_en_route'])
  ) {
    violations.push({
      keys: ['cancellation.customer_fee_arrived', 'cancellation.customer_fee_en_route'],
      message: 'The arrived cancellation fee must not be lower than the en-route fee.',
    });
  }

  if (
    rupeesValue(snapshot['cancellation.driver_penalty_arrived']) <
    rupeesValue(snapshot['cancellation.driver_penalty_en_route'])
  ) {
    violations.push({
      keys: ['cancellation.driver_penalty_arrived', 'cancellation.driver_penalty_en_route'],
      message: 'The arrived driver penalty must not be lower than the en-route penalty.',
    });
  }

  return violations;
}
