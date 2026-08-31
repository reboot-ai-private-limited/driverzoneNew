'use client';

import { formatPaise } from '@/lib/format';
import { commissionSplit, percentToBps, rupeesToPaise } from '../lib/money';

/**
 * The live commission split. `docs/LLD/admin-panel.md` calls this essential and it is: a
 * commission error is invisible in a form field and obvious in a rupee figure.
 *
 * IT SPLITS THE FARE; IT IS NOT THE FARE. There is no "customer pays" total, because the pickup
 * fee, the time-of-day surcharge, insurance and tax belong to the `pricing` module, which does
 * not exist yet. A total assembled from half the formula would be a number the admin trusts and
 * we could not honour.
 *
 * It no longer warns about an unallocated remainder, because there cannot be one: the company's
 * share is `fare − driver's share`, derived rather than stored. That check was the whole reason
 * this used to return a `residualPaise`, and it went when the second stored share did.
 */
export interface CommissionSplitLineProps {
  label: string;
  /** The fare, in rupees, as typed. */
  fare: string;
  /** The driver's share, as a typed percentage. */
  driverPercent: string;
}

export function CommissionSplitLine({ label, fare, driverPercent }: CommissionSplitLineProps) {
  const farePaise = rupeesToPaise(fare);
  const driverBps = percentToBps(driverPercent);

  if (farePaise === null || driverBps === null) {
    return (
      <p className="text-xs text-text-subtle">
        {label}: fill in the fare and the driver&apos;s share to see the split.
      </p>
    );
  }

  const split = commissionSplit(farePaise, driverBps);

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
