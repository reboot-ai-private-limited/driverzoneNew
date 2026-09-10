'use client';

import { formatPaise } from '@/lib/format';
import { commissionSplit, rupeesToPaise } from '../lib/money';

/**
 * The live commission split. `docs/LLD/admin-panel.md` calls this essential and it is: a
 * commission error is invisible in a form field and obvious in a rupee figure.
 *
 * IT SPLITS THE FARE; IT IS NOT THE FARE. There is no "customer pays" total, because the pickup
 * fee, the time-of-day surcharge, insurance and tax belong to the `pricing` module, which does
 * not exist yet. A total assembled from half the formula would be a number the admin trusts and
 * we could not honour.
 *
 * The driver's share is a flat amount now (2026-09-10), not a percent of the fare — `driverAmount`
 * is rupees as typed. The company's share is still `fare − driver`, derived rather than stored,
 * which is why this no longer warns about an unallocated remainder.
 */
export interface CommissionSplitLineProps {
  label: string;
  /** The fare, in rupees, as typed. */
  fare: string;
  /** What the driver is paid, in rupees as typed. */
  driverAmount: string;
}

export function CommissionSplitLine({ label, fare, driverAmount }: CommissionSplitLineProps) {
  const farePaise = rupeesToPaise(fare);
  const driverAmountPaise = rupeesToPaise(driverAmount);

  if (farePaise === null || driverAmountPaise === null) {
    return (
      <p className="text-xs text-text-subtle">
        {label}: fill in the fare and the driver&apos;s amount to see the split.
      </p>
    );
  }

  const split = commissionSplit(farePaise, driverAmountPaise);

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <span className="text-text-subtle">
        {label} <strong className="font-medium text-text">{formatPaise(split.basePaise)}</strong>
      </span>
      <span className="text-text-subtle">
        Driver earns{' '}
        <strong className="font-medium text-text">{formatPaise(split.driverPaise)}</strong>
      </span>
      <span className="text-text-subtle">
        Company keeps{' '}
        <strong className="font-medium text-text">{formatPaise(split.companyPaise)}</strong>
      </span>
    </p>
  );
}
