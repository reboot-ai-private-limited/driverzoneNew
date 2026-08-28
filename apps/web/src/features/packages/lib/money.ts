/**
 * Rupees ⇄ paise, percent ⇄ basis points, and the commission split.
 *
 * TWO UNITS MEET ON THIS SCREEN and mixing them is the expensive mistake:
 *
 *  - **Fares are integer PAISE.** `/admin/packages` takes and returns paise, everywhere, without
 *    exception (docs/engineering/coding-standards.md §Money).
 *  - **`/admin/settings` is whole RUPEES**, guarded there by an opaque `Rupees` type. Nothing
 *    here reads a setting, but an editor copied from the settings screen inherits its assumption.
 *  - **Commission is BASIS POINTS.** 7500 is 75%; the API rejects anything above 10000.
 *
 * The admin types rupees and percents. Conversion happens once, here, at the edge.
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

/** `'75'` → `7500`. Percent in, basis points out. `null` past 100%. */
export function percentToBps(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const bps = Math.round(Number(trimmed) * 100);
  return bps > 10000 ? null : bps;
}

export function bpsToPercent(bps: number): string {
  return bps % 100 === 0 ? String(bps / 100) : (bps / 100).toFixed(2);
}

export interface CommissionSplit {
  basePaise: number;
  driverPaise: number;
  companyPaise: number;
}

/**
 * How a fare divides between driver and company.
 *
 * THE COMPANY'S SHARE IS THE REMAINDER, and that is the whole design. The previous model stored
 * both sides independently, each with its own PERCENT/FLAT type, so a form could save 75% and
 * 20% and quietly leave 5% of every trip in nobody's column — this function used to return a
 * `residualPaise` field whose only job was to catch that. Deriving the company's share deletes
 * the failure mode rather than reporting it, so the field is gone with it.
 *
 * `Math.round` and not `floor`: the API's own fare maths rounds, and a preview that reads a
 * paisa low is a preview an admin learns to distrust. The company takes the rounding remainder,
 * so driver + company is always exactly the base.
 */
export function commissionSplit(basePaise: number, driverBps: number): CommissionSplit {
  const driverPaise = Math.round((basePaise * driverBps) / 10000);
  return {
    basePaise,
    driverPaise,
    companyPaise: basePaise - driverPaise,
  };
}
