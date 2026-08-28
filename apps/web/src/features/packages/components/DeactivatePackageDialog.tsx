'use client';

import type { OutstationPackageDto } from '@driverzone/contracts';
import { ConfirmDialog } from '@driverzone/design-system';
import { useUpdateOutstationPackage } from '../hooks/usePackageMutations';
import { coverageLostWithout, formatBand, type LadderBand } from '../lib/band';

/**
 * Deactivating a band, with its blast radius spelled out.
 *
 * There is no DELETE route and there should not be: a band that has ever priced a booking is
 * cited by that booking's frozen fare snapshot, and removing the row would orphan it. So this is
 * a `PUT { isActive: false }`, and the dialog says what that costs.
 *
 * THE CONSEQUENCES ARE COMPUTED, not assumed. The naive line — "70–100 km will be uncovered" —
 * is wrong whenever a neighbour already overlaps part of the range, and overstating the damage
 * teaches an admin to click through the warning. `coverageLostWithout` rebuilds the ladder
 * without this band and reports only the gaps that actually appear.
 *
 * Blocking outright would be wrong too: sometimes ops genuinely must pull a band. Show the
 * damage, let a human decide — the same shape as `DeactivateZoneDialog`.
 */

export interface DeactivatePackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  band: OutstationPackageDto;
  /** Every active band of this terrain, this one included. */
  allBands: LadderBand[];
}

export function DeactivatePackageDialog({
  open,
  onOpenChange,
  band,
  allBands,
}: DeactivatePackageDialogProps) {
  const update = useUpdateOutstationPackage(band.id, () => onOpenChange(false));

  const lost = coverageLostWithout(allBands, band.id);

  const consequences =
    lost.length === 0
      ? [
          <>
            No distance loses coverage — another {band.terrain === 'HILL' ? 'hills' : 'plains'} band
            already spans this range.
          </>,
        ]
      : lost.map((segment) => (
          <>
            <strong className="font-medium">{formatBand(segment.from, segment.to)}</strong> will have
            no {band.terrain === 'HILL' ? 'hills' : 'plains'} price. Those trips return{' '}
            <code>NO_PACKAGE_FOR_DISTANCE</code> — we decline the booking rather than quote it off
            the other terrain&apos;s ladder.
          </>
        ));

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Deactivate ${band.name}?`}
      consequences={consequences}
      confirmLabel="Deactivate"
      loading={update.isPending}
      onConfirm={() => update.mutate({ isActive: false })}
    >
      <p className="text-sm text-text-subtle">
        The band and its prices are kept — bookings already quoted from it cite these rows in their
        fare snapshot. It stops matching new quotes and leaves the coverage ladder.
      </p>
    </ConfirmDialog>
  );
}
