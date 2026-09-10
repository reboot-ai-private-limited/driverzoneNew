/**
 * DOMAIN — dividing a fare between the driver and the company.
 *
 * ONE FIGURE IS SET, AND THE COMPANY GETS THE REMAINDER. Both shares used to be stored
 * independently, each with its own `PERCENT | FLAT` type, which let a form save 75% and 20% and
 * quietly leave 5% of every trip in nobody's column. Deriving one from the other deletes that
 * failure mode rather than validating against it, and makes the reconciliation below true by
 * construction. That still holds — only which side is configured has changed.
 *
 * THE CONFIGURED SIDE IS NOW AN AMOUNT, NOT A RATE (2026-09-10). The package says what the driver
 * is paid; the company takes what is left. Under the old rate the driver's payout moved every
 * time a surcharge or a paid pickup landed on the same trip, which made "what does this job pay"
 * a question nobody could answer before the trip was priced.
 *
 * SO THE COMPANY ABSORBS THE VARIANCE NOW. Every extra line — pickup, surcharge, insurance —
 * accrues entirely to the company, where it used to be split. That is the intended consequence,
 * and it is also why the company's share can be squeezed by lines it does not control: see the
 * clamp below.
 *
 * TAX IS NOT SHARED. It is collected on behalf of the government and passed through; a driver has
 * no claim on it and neither does the company.
 */

import { AppError } from '../../../shared/errors/AppError.js';
import type { FareSplit } from './fare.entity.js';

/**
 * Pays the driver their amount out of the commissionable total; the company keeps the rest.
 *
 * THE CLAMP IS A BACKSTOP, NOT A POLICY. `packages.validation.ts` refuses to save a driver amount
 * above the package's own fare, so in the ordinary case there is always a remainder. It can still
 * be reached the long way round — an admin cuts a fare without touching the driver amount on a
 * package that predates the check, or a multi-day outstation trip whose day multiplier applies to
 * both sides but whose fixed lines do not scale — and the honest response to "we owe the driver
 * more than we collected" is to pay it and shout, not to quietly hand the driver less than the
 * package promised them.
 *
 * So: the driver is paid in full and the company's share floors at zero. It does not throw and it
 * does not log — this module is PURE by design (it is why the most dispute-prone logic in the
 * product is testable without a database), so the detection belongs where the configuration is
 * written, not where it is read. A customer standing at a pickup point is also not the right
 * person to discover a pricing misconfiguration.
 */
export function splitFare(commissionablePaise: number, driverAmountPaise: number): FareSplit {
  const driverPaise = Math.min(driverAmountPaise, commissionablePaise);

  return {
    commissionablePaise,
    // Recorded as configured, not as clamped — the pair is what makes a shortfall visible later.
    driverAmountPaise,
    driverPaise,
    companyPaise: commissionablePaise - driverPaise,
  };
}

/**
 * The reconciliation the LLD asks to be a runtime assertion, not just a test.
 *
 * This is cheap and it runs on every quote, because fare arithmetic that does not reconcile is
 * how you end up unable to close the books — and it is far better found here, as a 500 on one
 * quote, than found in an accounting spreadsheet a quarter later. It is a genuine invariant
 * violation rather than bad input, so it is `AppError.internal` and pages someone.
 */
export function assertFareReconciles(split: FareSplit, taxPaise: number, totalPaise: number): void {
  const sum = split.driverPaise + split.companyPaise + taxPaise;
  if (sum !== totalPaise) {
    throw AppError.internal('INTERNAL', {
      reason: 'Fare does not reconcile: driver + company + tax must equal the total',
      driverPaise: split.driverPaise,
      companyPaise: split.companyPaise,
      taxPaise,
      totalPaise,
      difference: sum - totalPaise,
    });
  }
}
