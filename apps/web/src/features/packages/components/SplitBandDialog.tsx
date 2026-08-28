'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { OutstationPackageDto } from '@driverzone/contracts';
import { Button, Dialog, FormField, Input, toast } from '@driverzone/design-system';
import { ApiError } from '@/lib/api/ApiError';
import { packagesApi } from '@/lib/api/endpoints/packages';
import { newIdempotencyKey } from '@/lib/api/idempotency';
import { withAuth } from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';
import { formatPaise } from '@/lib/format';
import { formatBand, splitAt, validateSplit } from '../lib/band';
import { buildOutstationBody, splitDraftFrom } from '../lib/draft';

/**
 * Breaking one band into two.
 *
 * Flat band pricing needs many narrow bands — `open-questions.md` Q3 said so when it warned what
 * flat pricing costs — so "this band should really be two" is a routine operation, not an edge
 * case. Without this it is: edit the original's upper bound down, get told nothing, then create
 * the second band, with a 409 waiting for anyone who does it in the other order.
 *
 * TWO WRITES, IN THIS ORDER AND NO OTHER:
 *
 *   1. `PUT` the original down to `[minKm, splitKm)`. A shrink can never collide with anything.
 *   2. `POST` the new `[splitKm, maxKm)`. By then the space is free, so no bypass of the overlap
 *      guard is needed anywhere — P-2 holds throughout.
 *
 * There is no transaction to wrap them in: the dev Mongo is a standalone node, not a replica
 * set. So step 2 CAN fail with step 1 already committed, and the honest handling is to say so
 * rather than report a success. The band list is the safety net — the range that did not get
 * created shows up as a red gap row whose Add band action is pre-filled to exactly it — and this
 * dialog points the admin at that instead of leaving them to discover it.
 *
 * It is deliberately not a `useApiMutation`: that factory does one call, and its error toast
 * would say "band created" failed without distinguishing which half of the split is on the
 * floor.
 */

export interface SplitBandDialogProps {
  band: OutstationPackageDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SplitBandDialog({ band, open, onOpenChange }: SplitBandDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [splitKm, setSplitKm] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const parsed = /^\d+$/.test(splitKm.trim()) ? Number(splitKm.trim()) : Number.NaN;
  const localError = Number.isNaN(parsed)
    ? undefined
    : (validateSplit({ minKm: band.min_km, maxKm: band.max_km }, parsed) ?? undefined);
  const preview = localError === undefined && !Number.isNaN(parsed);

  async function onSplit() {
    if (!preview) {
      setError(localError ?? 'Enter a whole number of km inside this band.');
      return;
    }
    const [lower, upper] = splitAt({ minKm: band.min_km, maxKm: band.max_km }, parsed);

    const newBand = buildOutstationBody(
      splitDraftFrom(band, upper.minKm, `${band.name} (${upper.minKm}+)`),
    );
    // Cannot fail — the draft is built from a stored band — but the result type says it might,
    // and inventing a body past a `false` would be exactly the wrong way to satisfy it.
    if (!newBand.ok) {
      setError('This band cannot be split — its stored fares are not valid.');
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      await withAuth((token) =>
        packagesApi.updateOutstation(token, band.id, { maxKm: lower.maxKm }),
      );
    } catch (shrinkError) {
      setBusy(false);
      // Nothing has changed; the original band is intact. Ordinary failure.
      setError(shrinkError instanceof ApiError ? shrinkError.message : 'Could not resize the band.');
      return;
    }

    try {
      await withAuth((token) =>
        packagesApi.createOutstation(token, newBand.body, newIdempotencyKey()),
      );
    } catch (createError) {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: keys.packages.all() });
      // THE HALF-DONE CASE. The original is already shrunk, so the upper stretch is uncovered
      // right now. Say that plainly and name the range — the list will show it as a gap row.
      setError(
        `${band.name} is now ${formatBand(lower.minKm, lower.maxKm)}, but the new ` +
          `${formatBand(upper.minKm, upper.maxKm)} band was not created` +
          `${createError instanceof ApiError ? `: ${createError.message}` : '.'} ` +
          'That range is uncovered — it is the red row in the list, and its Add band action is ' +
          'pre-filled with it.',
      );
      return;
    }

    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: keys.packages.all() });
    toast.success(`Split into ${formatBand(lower.minKm, lower.maxKm)} and ${formatBand(upper.minKm, upper.maxKm)}.`);
    onOpenChange(false);
    router.push('/packages');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
      title={`Split ${band.name}`}
      description={`Currently ${formatBand(band.min_km, band.max_km)}.`}
      footer={
        <>
          <Button size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void onSplit()} loading={busy}>
            Split band
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField
          label="Break at"
          hint={`A whole number between ${band.min_km} and ${band.max_km} km.`}
          required
          {...(localError === undefined ? {} : { error: localError })}
        >
          {({ id, invalid, describedBy }) => (
            <div className="flex items-center gap-2">
              <Input
                id={id}
                inputMode="numeric"
                value={splitKm}
                onChange={(event) => setSplitKm(event.target.value)}
                invalid={invalid}
                aria-describedby={describedBy}
                disabled={busy}
                className="w-28"
              />
              <span className="text-sm text-text-subtle">km</span>
            </div>
          )}
        </FormField>

        {preview && (
          <div className="rounded-md border border-border bg-surface-muted p-3 flex flex-col gap-1.5 text-sm">
            <SplitRow label={formatBand(band.min_km, parsed)} band={band} note="keeps this band" />
            <SplitRow label={formatBand(parsed, band.max_km)} band={band} note="new" />
          </div>
        )}

        <p className="text-xs text-text-subtle">
          The fares are <strong className="font-medium text-text">copied, not divided</strong>.
          Until you edit the new band, both halves cost the same — dividing a fare by distance
          would invent a per-km rate, and this product does not have one.
        </p>

        {error !== undefined && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

function SplitRow({
  label,
  band,
  note,
}: {
  label: string;
  band: OutstationPackageDto;
  note: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="font-medium text-text">{label}</span>
      <span className="text-text-subtle text-xs">
        {formatPaise(band.one_way_fare_paise)}
        {band.round_trip_fare_paise === null
          ? ' one-way'
          : ` / ${formatPaise(band.round_trip_fare_paise)}`}{' '}
        · {note}
      </span>
    </div>
  );
}
