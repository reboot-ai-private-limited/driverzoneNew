/**
 * DOMAIN — dividing a fare between the driver and the company.
 *
 * ONE RATE, AND THE COMPANY GETS THE REMAINDER. Both shares used to be stored independently,
 * each with its own `PERCENT | FLAT` type, which let a form save 75% and 20% and quietly leave
 * 5% of every trip in nobody's column. Deriving one from the other deletes that failure mode
 * rather than validating against it, and makes the reconciliation below true by construction.
 *
 * TAX IS NOT COMMISSIONABLE. It is collected on behalf of the government and passed through; a
 * driver has no claim on it and neither does the company.
 */

import { AppError } from '../../../shared/errors/AppError.js';
import type { FareSplit } from './fare.entity.js';

/**
 * Splits the commissionable amount at the driver's rate.
 *
 * `Math.round` on the driver's share and subtraction for the company's means the two always sum
 * to the input exactly, whatever the rate. Rounding both independently is how a half-paise turns
 * into a receipt whose lines do not add up.
 */
export function splitFare(commissionablePaise: number, driverCommissionBps: number): FareSplit {
  const driverPaise = Math.round((commissionablePaise * driverCommissionBps) / 10000);
  return {
    commissionablePaise,
    driverCommissionBps,
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
