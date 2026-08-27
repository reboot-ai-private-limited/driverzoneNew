'use client';

import type { ZoneDto } from '@driverzone/contracts';
import { ConfirmDialog } from '@driverzone/design-system';
import { useDeactivateZone } from '../hooks/useDeactivateZone';
import { useZoneDependents } from '../hooks/useZoneDependents';

/**
 * Deactivation, with the blast radius shown FIRST.
 *
 * Blocking outright is wrong — sometimes you genuinely must pull a zone. A bare "Are you sure?"
 * is also wrong, and worse, because the case that matters most looks exactly like every other
 * one: deactivating the LAST active pickup zone stops all service, incity and outstation both,
 * and nothing else on this screen would tell you that.
 *
 * So the warnings come from `GET /admin/zones/:id/dependents` — the server computes them,
 * because it is the side that can count the scheduled bookings and the packages going dark.
 * They never block; they inform, and a human decides.
 *
 * The one thing this dialog will not do is confirm while the warnings are still loading. A
 * confirm button that is live before the consequences have rendered is a confirm button that
 * gets pressed before they are read.
 */
export function DeactivateZoneDialog({
  zone,
  onOpenChange,
  onDeactivated,
}: {
  zone: ZoneDto | null;
  onOpenChange: (open: boolean) => void;
  onDeactivated: () => void;
}) {
  const dependents = useZoneDependents(zone?.id ?? null);
  const deactivate = useDeactivateZone();

  const warnings = dependents.data?.warnings ?? [];

  return (
    <ConfirmDialog
      open={zone !== null}
      onOpenChange={onOpenChange}
      title={zone === null ? '' : `Deactivate “${zone.name}”?`}
      consequences={
        dependents.isLoading
          ? ['Checking what depends on this zone…']
          : warnings.length > 0
            ? warnings
            : ['Nothing else in the system depends on this zone.']
      }
      confirmLabel="Deactivate anyway"
      loading={deactivate.isPending || dependents.isLoading}
      onConfirm={() => {
        if (zone === null) return;
        deactivate.mutate(zone.id, {
          onSuccess: () => {
            onOpenChange(false);
            onDeactivated();
          },
        });
      }}
    >
      <p className="mt-3 text-xs text-text-subtle">
        The zone is deactivated, not deleted — bookings that resolved against it keep their
        reference, and their fare snapshot records the geometry they were quoted on. Permanent
        removal is a separate action and only works once a zone is already inactive.
      </p>
    </ConfirmDialog>
  );
}
