'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Building2, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  DataState,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Panel,
  Select,
  SkeletonFieldList,
  TopProgressBar,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { useCityZones, useIncityPackage } from '../hooks/usePackages';
import { useCreateIncityPackage, useUpdateIncityPackage } from '../hooks/usePackageMutations';
import {
  buildIncityBody,
  emptyIncityDraft,
  emptyVariantDraft,
  toIncityDraft,
  type FieldErrors,
  type IncityDraft,
  type VariantDraft,
} from '../lib/draft';
import { CommissionSplitLine } from './CommissionSplitLine';
import { FareField } from './FareField';

/**
 * The InCity package editor — a full page, because the form is two levels deep: a package holds
 * variants, and each variant carries its own duration and fare.
 *
 * `PUT` REPLACES THE WHOLE `variants` ARRAY. The form therefore submits every variant every
 * time, not a diff of the ones that changed — the changed-fields-only idiom from
 * `CustomerEditDialog` would silently delete the variants it left out.
 */

export function IncityEditor() {
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;

  const detail = useIncityPackage(id);
  // The city zone is the only zone reference either product carries, and it is required on
  // create — so the picker is fed from the zones list rather than typed as an id.
  const zones = useCityZones();

  const [draft, setDraft] = useState<IncityDraft | undefined>(
    id === undefined ? emptyIncityDraft() : undefined,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (detail.data === undefined) return;
    setDraft(toIncityDraft(detail.data));
    setDirty(false);
  }, [detail.data]);

  const create = useCreateIncityPackage((pkg) => {
    setDirty(false);
    router.push(`/packages/incity/${pkg.id}`);
  });
  const update = useUpdateIncityPackage(id ?? '', () => setDirty(false));
  const saving = create.isPending || update.isPending;

  const edit = useCallback((next: IncityDraft) => {
    setDraft(next);
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const onSave = useCallback(() => {
    if (draft === undefined) return;
    const built = buildIncityBody(draft);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    if (id === undefined) create.mutate(built.body);
    else update.mutate(built.body);
  }, [draft, id, create, update]);

  const onLeave = useCallback(() => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    router.push('/packages');
  }, [dirty, router]);

  const title = id === undefined ? 'New package' : (detail.data?.name ?? 'Package');
  const cityZones = zones.data?.zones ?? [];
  const zoneOptions = cityZones.map((zone) => ({ value: zone.id, label: zone.name }));

  /**
   * No city zone drawn, and this is a CREATE. Blocked rather than rendered with an empty picker.
   *
   * The empty picker was the previous behaviour and it was the worst version: the admin filled in
   * a whole package, pressed Save, and got "pick the city zone" pointing at a dropdown with
   * nothing in it and no explanation of why. The dependency is real — an incity package is sold
   * against a city zone and cannot exist without one — so say that, and link to the screen that
   * fixes it.
   *
   * Only on create: an existing package already names its zone, and blocking the EDIT of one
   * because the zones list came back empty would be a worse failure than the one it prevents.
   */
  const blockedOnZones = id === undefined && !zones.isLoading && cityZones.length === 0;

  return (
    <div className="flex flex-col gap-4 pb-16">
      <TopProgressBar active={detail.isFetching || zones.isFetching || saving} />

      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Packages', href: '/packages' }, { label: title }]}
        onBack={onLeave}
        actions={
          blockedOnZones ? undefined : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-subtle" aria-live="polite">
                {dirty ? 'Unsaved changes' : 'No changes'}
              </span>
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
                {id === undefined ? 'Create package' : 'Save changes'}
              </Button>
            </div>
          )
        }
      />

      {blockedOnZones ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="No city zone to sell against"
          description="An incity package belongs to a city zone — it is the only zone reference either product carries. Draw one first, then come back."
          action={
            <Button variant="primary" size="sm" onClick={() => router.push('/zones')}>
              Go to zones
            </Button>
          }
        />
      ) : (
        <DataState
          loading={detail.isLoading}
          error={
            detail.isError ? toErrorState(detail.error, () => void detail.refetch()) : undefined
          }
          skeleton={<SkeletonFieldList rows={6} />}
        >
          {draft === undefined ? null : (
            <div className="flex flex-col gap-4">
              <Panel title="Package">
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

                  <FormField
                    label="City zone"
                    hint="The only zone either product references."
                    required
                    {...(errors['cityZoneId'] === undefined ? {} : { error: errors['cityZoneId'] })}
                  >
                    {({ id: fieldId }) => (
                      <Select
                        id={fieldId}
                        value={draft.cityZoneId}
                        onValueChange={(value) => edit({ ...draft, cityZoneId: value })}
                        options={zoneOptions}
                        placeholder={zones.isLoading ? 'Loading zones…' : 'Pick a city zone'}
                        disabled={saving}
                      />
                    )}
                  </FormField>

                  <FormField label="Description">
                    {({ id: fieldId }) => (
                      <Input
                        id={fieldId}
                        value={draft.description}
                        onChange={(event) => edit({ ...draft, description: event.target.value })}
                        disabled={saving}
                      />
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

                <p className="mt-4 text-xs text-text-subtle max-w-3xl">
                  Sold from every pickup zone. Packages do not reference pickup zones — a pickup
                  zone gates serviceability and adds its fee, and that is the whole of its job.
                </p>
              </Panel>

              <Panel
                title="Variants"
                actions={
                  <div className="flex items-center gap-3">
                    {errors['variants'] !== undefined && (
                      <span className="text-xs text-danger">{errors['variants']}</span>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Plus className="size-4" />}
                      disabled={saving}
                      onClick={() =>
                        edit({ ...draft, variants: [...draft.variants, emptyVariantDraft()] })
                      }
                    >
                      Add variant
                    </Button>
                  </div>
                }
              >
                <p className="text-xs text-text-subtle mb-4 max-w-3xl">
                  A variant is a duration option — 3 hours, 10 hours. The customer picks one, so a
                  quote returns every active variant, not just the cheapest. The fare does not
                  depend on the car, and there is no overage: running past the included time is an
                  operations conversation, not a fare line.
                </p>

                <div className="flex flex-col gap-3">
                  {draft.variants.map((variant, index) => (
                    <VariantCard
                      key={variant.key}
                      variant={variant}
                      index={index}
                      errors={errors}
                      disabled={saving}
                      onChange={(next) =>
                        edit({
                          ...draft,
                          variants: draft.variants.map((current) =>
                            current.key === variant.key ? next : current,
                          ),
                        })
                      }
                      onRemove={
                        draft.variants.length > 1
                          ? () =>
                              edit({
                                ...draft,
                                variants: draft.variants.filter(
                                  (current) => current.key !== variant.key,
                                ),
                              })
                          : undefined
                      }
                    />
                  ))}
                </div>
              </Panel>
            </div>
          )}
        </DataState>
      )}
    </div>
  );
}

interface VariantCardProps {
  variant: VariantDraft;
  index: number;
  errors: FieldErrors;
  disabled: boolean;
  onChange: (next: VariantDraft) => void;
  onRemove?: (() => void) | undefined;
}

/**
 * One variant, collapsed to a summary line and expandable to its fields.
 *
 * The summary is what a variant IS — a duration and a price. Both fit on the collapsed row, which
 * is what a variant has been reduced to: the included-km cap, the two overage rates, the
 * destination flag and the sort order all went on 2026-08-28.
 */
function VariantCard({ variant, index, errors, disabled, onChange, onRemove }: VariantCardProps) {
  // New rows open, saved rows closed: an empty variant exists only to be filled in.
  const [open, setOpen] = useState(variant.label === '');
  const scope = `variants.${variant.key}`;
  const hasError = Object.keys(errors).some((key) => key.startsWith(`${scope}.`));

  const set = <K extends keyof VariantDraft>(key: K, value: VariantDraft[K]) =>
    onChange({ ...variant, [key]: value });

  return (
    <div className="border border-border rounded-md">
      <div className="flex items-center gap-3 px-3 h-11">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 text-sm text-text min-w-0"
          aria-expanded={open}
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <span className="font-medium truncate">
            {variant.label === '' ? `Variant ${index + 1}` : variant.label}
          </span>
        </button>

        <span className="text-xs text-text-subtle truncate">
          {variant.includedMinutes === '' ? '—' : `${variant.includedMinutes} min`} ·{' '}
          {variant.baseFare === '' ? 'unpriced' : `₹${variant.baseFare}`}
        </span>

        {hasError && !open && <span className="text-xs text-danger">needs fixing</span>}
        {!variant.isActive && <span className="text-xs text-text-subtle">inactive</span>}

        <div className="ml-auto">
          {onRemove !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 className="size-4" />}
              disabled={disabled}
              onClick={onRemove}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="border-t border-border p-3 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <FormField
              label="Label"
              required
              {...(errors[`${scope}.label`] === undefined
                ? {}
                : { error: errors[`${scope}.label`] })}
            >
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  value={variant.label}
                  onChange={(event) => set('label', event.target.value)}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  disabled={disabled}
                  placeholder="3 Hours"
                />
              )}
            </FormField>

            <FormField
              label="Included time"
              hint="Minutes. There is no overage charge past it."
              required
              {...(errors[`${scope}.includedMinutes`] === undefined
                ? {}
                : { error: errors[`${scope}.includedMinutes`] })}
            >
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  value={variant.includedMinutes}
                  onChange={(event) => set('includedMinutes', event.target.value)}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  disabled={disabled}
                />
              )}
            </FormField>

            <FareField
              label="Base fare"
              value={variant.baseFare}
              onChange={(value) => set('baseFare', value)}
              error={errors[`${scope}.baseFare`]}
              disabled={disabled}
              required
            />

            <FareField
              label="Driver is paid"
              hint="A flat amount. The company keeps the rest of the fare."
              value={variant.driverAmount}
              onChange={(value) => set('driverAmount', value)}
              error={errors[`${scope}.driverAmount`]}
              disabled={disabled}
              required
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-text">
            <input
              type="checkbox"
              checked={variant.isActive}
              onChange={(event) => set('isActive', event.target.checked)}
              disabled={disabled}
              className="size-4 accent-interactive"
            />
            Active
          </label>

          <div className="border-t border-border pt-3">
            <CommissionSplitLine
              label="Base fare"
              fare={variant.baseFare}
              driverAmount={variant.driverAmount}
            />
          </div>
        </div>
      )}
    </div>
  );
}
