'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Building2 } from 'lucide-react';
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
  toIncityDraft,
  type FieldErrors,
  type IncityDraft,
} from '../lib/draft';
import { VariantsPanel } from './VariantsPanel';

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

              <VariantsPanel
                variants={draft.variants}
                errors={errors}
                disabled={saving}
                minVariants={1}
                onChange={(variants) => edit({ ...draft, variants })}
              />
            </div>
          )}
        </DataState>
      )}
    </div>
  );
}
