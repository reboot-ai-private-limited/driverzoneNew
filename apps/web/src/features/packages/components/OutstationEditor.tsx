'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { TERRAINS, type Terrain } from '@driverzone/contracts';
import {
  Button,
  DataState,
  FormField,
  Input,
  PageHeader,
  Panel,
  Select,
  SkeletonFieldList,
  TopProgressBar,
} from '@driverzone/design-system';
import { ApiError } from '@/lib/api/ApiError';
import { toErrorState } from '@/lib/api/toErrorState';
import { useOutstationPackage, useOutstationPackages } from '../hooks/usePackages';
import {
  useCreateOutstationPackage,
  useUpdateOutstationPackage,
} from '../hooks/usePackageMutations';
import {
  buildOutstationBody,
  emptyOutstationDraft,
  toOutstationDraft,
  type FieldErrors,
  type OutstationDraft,
  type OutstationPrefill,
} from '../lib/draft';
import { findOverlap, ladderFor } from '../lib/band';
import { CommissionSplitLine } from './CommissionSplitLine';
import { FareField } from './FareField';
import { VariantsPanel } from './VariantsPanel';
import { DeactivatePackageDialog } from './DeactivatePackageDialog';

/**
 * The outstation band editor.
 *
 * It used to carry a ten-row price grid and a coverage ladder. Both are gone: the band is two
 * fares and a driver amount now, and the list it came from shows the coverage. What stays is the
 * live overlap warning, because that is the one thing the admin cannot see from this form alone.
 */

const TERRAIN_OPTIONS = TERRAINS.map((terrain) => ({
  value: terrain,
  label: terrain === 'HILL' ? 'Hills' : 'Plains',
}));

export function OutstationEditor() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const search = useSearchParams();
  const id = typeof params.id === 'string' ? params.id : undefined;

  /**
   * The gap the admin clicked, carried in the query string. Read ONCE into the initial draft
   * rather than kept in sync: after the first render these fields belong to the admin, and a
   * later re-read would overwrite what they typed.
   */
  const [prefill] = useState<OutstationPrefill>(() => ({
    terrain: search.get('terrain') === 'HILL' ? 'HILL' : 'PLAIN',
    ...(search.get('minKm') === null ? {} : { minKm: search.get('minKm') as string }),
    ...(search.get('maxKm') === null ? {} : { maxKm: search.get('maxKm') as string }),
  }));

  const detail = useOutstationPackage(id);
  const list = useOutstationPackages();

  const [draft, setDraft] = useState<OutstationDraft | undefined>(
    id === undefined ? emptyOutstationDraft(prefill) : undefined,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  // Seeded in an effect, never derived during render: deriving it would rebuild the draft from
  // the server on every keystroke and the fields would be read-only.
  useEffect(() => {
    if (detail.data === undefined) return;
    setDraft(toOutstationDraft(detail.data));
    setDirty(false);
  }, [detail.data]);

  const create = useCreateOutstationPackage((pkg) => {
    setDirty(false);
    router.push(`/packages/outstation/${pkg.id}`);
  });
  const update = useUpdateOutstationPackage(id ?? '', () => setDirty(false));
  const saving = create.isPending || update.isPending;

  const edit = useCallback((next: OutstationDraft) => {
    setDraft(next);
    setDirty(true);
  }, []);

  /**
   * The browser's own "leave site?" prompt — crude, unstyleable, and the only thing that survives
   * a closed tab, which is how a full-page form's work is actually lost.
   */
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Memoised because it feeds a `useMemo` dependency list: `?? []` mints a fresh array on every
  // render, which would re-run the overlap check on every keystroke anywhere on the page.
  const others = useMemo(() => list.data?.packages ?? [], [list.data]);

  /**
   * The client-side half of P-2, shown while the admin types rather than after a round trip.
   *
   * The server is still the authority — it answers 409 `PACKAGE_BAND_OVERLAP` and this only sees
   * the bands the list happened to load. What it buys is the admin finding out before they save.
   */
  const conflict = useMemo(() => {
    if (draft === undefined) return null;
    const minKm = Number(draft.minKm);
    const maxKm = Number(draft.maxKm);
    if (!Number.isInteger(minKm) || !Number.isInteger(maxKm) || maxKm <= minKm) return null;
    return findOverlap({ terrain: draft.terrain, minKm, maxKm, id }, others);
  }, [draft, others, id]);

  const onSave = useCallback(() => {
    if (draft === undefined) return;
    const built = buildOutstationBody(draft);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    const onError = (error: Error) => {
      // The toast already carries the server's wording. This is the field-level half: a 409
      // names the band it collided with, and that belongs on the km inputs.
      if (error instanceof ApiError && error.code === 'PACKAGE_BAND_OVERLAP') {
        setErrors({ maxKm: error.message });
      }
    };
    if (id === undefined) create.mutate(built.body, { onError });
    else update.mutate(built.body, { onError });
  }, [draft, id, create, update]);

  const onLeave = useCallback(() => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    router.push('/packages');
  }, [dirty, router]);

  const title = id === undefined ? 'New band' : (detail.data?.name ?? 'Band');

  return (
    <div className="flex flex-col gap-4 pb-16">
      <TopProgressBar active={detail.isFetching || list.isFetching || saving} />

      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Packages', href: '/packages' }, { label: title }]}
        onBack={onLeave}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-subtle" aria-live="polite">
              {dirty ? 'Unsaved changes' : 'No changes'}
            </span>
            {id !== undefined && draft?.isActive === true && (
              <Button variant="ghost" size="sm" onClick={() => setDeactivating(true)}>
                Deactivate
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onLeave} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onSave}
              loading={saving}
              disabled={draft === undefined}
            >
              {id === undefined ? 'Create band' : 'Save changes'}
            </Button>
          </div>
        }
      />

      <DataState
        loading={detail.isLoading}
        error={detail.isError ? toErrorState(detail.error, () => void detail.refetch()) : undefined}
        skeleton={<SkeletonFieldList rows={6} />}
      >
        {draft === undefined ? null : (
          <div className="flex flex-col gap-4">
            <Panel title="Band">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <FormField
                  label="Name"
                  required
                  {...(errors['name'] === undefined ? {} : { error: errors['name'] })}
                >
                  {({ id: fieldId, invalid, describedBy }) => (
                    <Input
                      id={fieldId}
                      value={draft.name}
                      onChange={(event) => edit({ ...draft, name: event.target.value })}
                      invalid={invalid}
                      aria-describedby={describedBy}
                      disabled={saving}
                    />
                  )}
                </FormField>

                <FormField label="Terrain" hint="Read off the DROP point, never the route.">
                  {({ id: fieldId }) => (
                    <Select
                      id={fieldId}
                      value={draft.terrain}
                      onValueChange={(value) => edit({ ...draft, terrain: value as Terrain })}
                      options={TERRAIN_OPTIONS}
                      disabled={saving}
                    />
                  )}
                </FormField>

                <FormField
                  label="Distance band"
                  hint="Half-open: the upper bound belongs to the next band."
                  required
                  {...((errors['minKm'] ?? errors['maxKm']) === undefined
                    ? {}
                    : { error: errors['minKm'] ?? errors['maxKm'] })}
                >
                  {({ id: fieldId, invalid, describedBy }) => (
                    <div className="flex items-center gap-2">
                      <Input
                        id={fieldId}
                        inputMode="numeric"
                        value={draft.minKm}
                        onChange={(event) => edit({ ...draft, minKm: event.target.value })}
                        invalid={invalid}
                        aria-describedby={describedBy}
                        aria-label="Lower bound in km"
                        disabled={saving}
                        className="w-24"
                      />
                      <span className="text-text-subtle text-sm">–</span>
                      <Input
                        inputMode="numeric"
                        value={draft.maxKm}
                        onChange={(event) => edit({ ...draft, maxKm: event.target.value })}
                        invalid={invalid}
                        aria-label="Upper bound in km"
                        disabled={saving}
                        className="w-24"
                      />
                      <span className="text-text-subtle text-sm">km</span>
                    </div>
                  )}
                </FormField>

                <FormField label="Status">
                  {() => (
                    <label className="flex items-center gap-2 text-sm text-text h-10">
                      <input
                        type="checkbox"
                        checked={draft.isActive}
                        onChange={(event) => edit({ ...draft, isActive: event.target.checked })}
                        disabled={saving}
                        className="size-4 accent-interactive"
                      />
                      Active
                    </label>
                  )}
                </FormField>
              </div>

              {conflict !== null && (
                <p className="mt-4 flex items-start gap-2 text-xs text-danger">
                  <TriangleAlert className="size-4 shrink-0 mt-px" />
                  <span>
                    This range overlaps{' '}
                    <Link
                      href={`/packages/outstation/${conflict.id}`}
                      className="underline font-medium"
                    >
                      {conflict.name}
                    </Link>{' '}
                    ({conflict.min_km}–{conflict.max_km} km, same terrain). Two active bands of one
                    terrain may not overlap — the save will be refused. To break an existing band
                    in two, use its <strong className="font-medium">Split</strong> action instead.
                  </span>
                </p>
              )}
            </Panel>

            <Panel title="Pricing">
              <p className="text-xs text-text-subtle mb-4 max-w-3xl">
                The fare is <strong className="font-medium text-text">flat across the band</strong>
                : every trip that lands in this range pays the same, whichever car it is. A round
                return fare covers the whole{' '}
                <strong className="font-medium text-text">two-way journey</strong> — out and back,
                however many days that takes — and is set independently, never as a multiple of
                the one-way.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <FareField
                  label="One-way fare"
                  value={draft.oneWayFare}
                  onChange={(value) => edit({ ...draft, oneWayFare: value })}
                  error={errors['oneWayFare']}
                  disabled={saving}
                  required
                />
                <FareField
                  label="Driver paid (one-way)"
                  hint="Per day. The company keeps the rest."
                  value={draft.oneWayDriverAmount}
                  onChange={(value) => edit({ ...draft, oneWayDriverAmount: value })}
                  error={errors['oneWayDriverAmount']}
                  disabled={saving}
                  required
                />
                <FareField
                  label="Return fare"
                  hint="The whole two-way journey. Blank if not offered."
                  value={draft.roundTripFare}
                  onChange={(value) => edit({ ...draft, roundTripFare: value })}
                  error={errors['roundTripFare']}
                  disabled={saving}
                />
                <FareField
                  label="Driver paid (return)"
                  hint="Per day. Blank if no return sold."
                  value={draft.roundTripDriverAmount}
                  onChange={(value) => edit({ ...draft, roundTripDriverAmount: value })}
                  error={errors['roundTripDriverAmount']}
                  disabled={saving || draft.roundTripFare.trim() === ''}
                  required={draft.roundTripFare.trim() !== ''}
                />
              </div>

              <div className="mt-4 flex flex-col gap-1.5">
                <CommissionSplitLine
                  label="One-way"
                  fare={draft.oneWayFare}
                  driverAmount={draft.oneWayDriverAmount}
                />
                {draft.roundTripFare.trim() !== '' && (
                  <CommissionSplitLine
                    label="Return"
                    fare={draft.roundTripFare}
                    driverAmount={draft.roundTripDriverAmount}
                  />
                )}
              </div>
            </Panel>

            <VariantsPanel
              title="Hourly packages"
              description="Optional hourly variants offered on this band (e.g. 8 Hours, 12 Hours). When configured, customers can choose an hourly package variant instead of the flat distance rate."
              variants={draft.variants}
              errors={errors}
              disabled={saving}
              minVariants={0}
              onChange={(variants) => edit({ ...draft, variants })}
            />
          </div>
        )}
      </DataState>

      {id !== undefined && detail.data !== undefined && (
        <DeactivatePackageDialog
          open={deactivating}
          onOpenChange={setDeactivating}
          band={detail.data}
          allBands={ladderFor(others, detail.data.terrain)}
        />
      )}
    </div>
  );
}
