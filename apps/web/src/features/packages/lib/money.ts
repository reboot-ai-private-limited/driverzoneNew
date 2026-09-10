/**
 * Rupees ⇄ paise, and the driver/company split.
 *
 * TWO UNITS MEET ON THIS SCREEN and mixing them is the expensive mistake:
 *
 *  - **Fares and the driver's amount are integer PAISE.** `/admin/packages` takes and returns
 *    paise, everywhere, without exception (docs/engineering/coding-standards.md §Money).
 *  - **`/admin/settings` is whole RUPEES**, guarded there by an opaque `Rupees` type. Nothing
 *    here reads a setting, but an editor copied from the settings screen inherits its assumption.
 *
 * The driver's share used to be a PERCENT (basis points on the wire). It is a flat rupee amount
 * now (2026-09-10) — `percentToBps` / `bpsToPercent` went with the change. The admin types
 * rupees; conversion happens once, here, at the edge.
 */

/** `'900'` → `90000`. `null` for anything that is not a non-negative number of rupees. */
export function rupeesToPaise(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // Rupees and at most two decimal places. `Number()` would accept '1e3', '0x10' and ' 1 '.
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  return Math.round(Number(trimmed) * 100);
}

/** `90000` → `'900'`. Trailing `.00` dropped, because a whole rupee is how ops writes a fare. */
export function paiseToRupees(paise: number): string {
  return paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2);
}

export interface CommissionSplit {
  basePaise: number;
  driverPaise: number;
  companyPaise: number;
}

/**
 * How a fare divides between driver and company.
 *
 * THE DRIVER'S SHARE IS A SET AMOUNT NOW; THE COMPANY GETS THE REMAINDER. The previous model
 * stored a rate, so this multiplied. It also used to store both sides independently — a form
 * could save 75% and 20% and leave 5% of every trip in nobody's column — which is why this
 * once returned a `residualPaise` field. Deriving one side deletes that failure mode; the field
 * went with it.
 *
 * `Math.min`, mirroring the API's own `splitFare`: a driver amount above the fare it is paid out
 * of is refused when the package is saved, but this preview must not render a negative company
 * share if one slips through (an old package, a fare cut). Driver capped at the fare, company
 * floored at zero.
 */
export function commissionSplit(basePaise: number, driverAmountPaise: number): CommissionSplit {
  const driverPaise = Math.min(Math.max(driverAmountPaise, 0), basePaise);
  return {
    basePaise,
    driverPaise,
    companyPaise: basePaise - driverPaise,
  };
}
