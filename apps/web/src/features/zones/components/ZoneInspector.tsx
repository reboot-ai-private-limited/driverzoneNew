'use client';

import { Download, Mountain, Pencil, Power, Upload } from 'lucide-react';
import type { PickupChargeType, ZoneDto, ZoneType } from '@driverzone/contracts';
import type { Polygon } from '@driverzone/geo';
import {
  Badge,
  Button,
  DefinitionList,
  FieldRow,
  FormField,
  Input,
  Select,
  StatusPill,
} from '@driverzone/design-system';
import { formatPaise } from '@/lib/format';
import type { ZoneValidation } from '../hooks/useZoneValidation';
import { ZoneViolations } from './ZoneViolations';

/**
 * The panel under the map: what this zone is, and — in edit mode — what it is becoming.
 *
 * THE VIEW/EDIT SPLIT MIRRORS THE API'S TWO ROUTES, and that is not cosmetic. `PATCH /:id`
 * changes a name and versions nothing; `PATCH /:id/geometry` creates a new version, carries an
 * `expected_version` concurrency contract, and needs the blast radius shown first. Giving them
 * one combined form would make every rename inherit a boundary edit's failure modes
 * (docs/LLD/zones.md §HTTP surface).
 *
 * So metadata is edited in place and saves on its own, and geometry is an explicit MODE — the
 * rest of the screen dims, the draw tools come up, and Save is a different button doing a
 * different thing.
 */

export interface ZoneForm {
  name: string;
  code: string;
  chargeType: PickupChargeType | 'NONE';
  /** The rupee string as typed. Empty means "fall back to the global default", not zero. */
  fee: string;
}

export interface ZoneInspectorProps {
  mode: 'view' | 'edit';
  /** `null` while creating — there is no saved zone behind the form yet. */
  zone: ZoneDto | null;
  type: ZoneType;
  form: ZoneForm;
  onFormChange: (form: ZoneForm) => void;
  draft: Polygon | null;
  validation: ZoneValidation;
  saving: boolean;
  onEditGeometry: () => void;
  onImport: () => void;
  onExport: () => void;
  onDeactivate: () => void;
  onShowOnMap: (geometry: Polygon) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function ZoneInspector(props: ZoneInspectorProps) {
  const { mode, zone, type } = props;

  if (mode === 'view' && zone === null) {
    return (
      <div className="p-4 text-xs text-text-subtle">
        Select a zone from the list, or click one on the map.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-semibold text-text truncate">
            {mode === 'edit' && zone === null ? `New ${type.toLowerCase()} zone` : zone?.name}
          </h2>
          <StatusPill status={type} />
          {zone !== null && (
            <>
              <Badge tone="neutral">v{zone.version}</Badge>
              {!zone.is_active && <Badge tone="neutral">Inactive</Badge>}
            </>
          )}
        </div>
      </header>

      {mode === 'view' ? <ViewBody {...props} /> : <EditBody {...props} />}
    </div>
  );
}

function ViewBody({
  zone,
  validation,
  onEditGeometry,
  onImport,
  onExport,
  onDeactivate,
}: ZoneInspectorProps) {
  if (zone === null) return null;

  return (
    <>
      <DefinitionList>
        <FieldRow label="Code">{zone.code}</FieldRow>
        <FieldRow label="Area">
          <span className="tabular-nums">{validation.areaKm2.toFixed(2)} km²</span>
        </FieldRow>
        <FieldRow label="Vertices">
          <span className="tabular-nums">{validation.vertexCount}</span>
        </FieldRow>
        {zone.pickup_charge_type !== undefined && (
          <FieldRow label="Pickup charge">
            <span className="inline-flex items-center gap-1.5">
              <StatusPill status={zone.pickup_charge_type} />
              {zone.pickup_charge_type === 'PAID' &&
                (zone.pickup_charge_paise == null ? (
                  <span className="text-text-subtle">global default</span>
                ) : (
                  formatPaise(zone.pickup_charge_paise)
                ))}
            </span>
          </FieldRow>
        )}
      </DefinitionList>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          icon={<Pencil aria-hidden className="size-3.5" />}
          onClick={onEditGeometry}
        >
          Edit boundary
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Upload aria-hidden className="size-3.5" />}
          onClick={onImport}
        >
          Replace from GeoJSON
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<Download aria-hidden className="size-3.5" />}
          onClick={onExport}
        >
          Export
        </Button>
        {zone.is_active && (
          <Button
            size="sm"
            variant="ghost"
            className="text-danger ml-auto"
            icon={<Power aria-hidden className="size-3.5" />}
            onClick={onDeactivate}
          >
            Deactivate
          </Button>
        )}
      </div>
    </>
  );
}

function EditBody({
  zone,
  type,
  form,
  onFormChange,
  draft,
  validation,
  saving,
  onImport,
  onShowOnMap,
  onCancel,
  onSave,
}: ZoneInspectorProps) {
  const creating = zone === null;
  const set = <K extends keyof ZoneForm>(key: K, value: ZoneForm[K]): void =>
    onFormChange({ ...form, [key]: value });

  // Save is blocked on an ERROR, never on a WARN. The API refuses an ERROR anyway — `createZone`
  // is the invariant choke point — and the UI's job is to make sure nobody gets that far. A
  // 600-vertex hill zone is a Z-COMPLEXITY warning and a perfectly legal save.
  const blocked =
    draft === null ||
    validation.errors.length > 0 ||
    form.name.trim() === '' ||
    form.code.trim() === '';

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Name" required>
          {({ id, invalid }) => (
            <Input
              id={id}
              invalid={invalid}
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
              placeholder="Siliguri Paid North"
            />
          )}
        </FormField>

        <FormField label="Code" required hint="Unique among active zones.">
          {({ id, invalid, describedBy }) => (
            <Input
              id={id}
              invalid={invalid}
              aria-describedby={describedBy}
              value={form.code}
              onChange={(event) => set('code', event.target.value.toUpperCase())}
              placeholder="SLG-PAID-N"
            />
          )}
        </FormField>

        {/*
          Pickup only. A city or hill zone has no charge — the fee is a property of the
          serviceability gate and nothing else, which is the whole of a pickup zone's job
          besides answering "may we pick up here" (docs/LLD/zones.md).
        */}
        {type === 'PICKUP' && (
          <>
            <FormField label="Charge">
              {({ id }) => (
                <Select
                  id={id}
                  value={form.chargeType}
                  onValueChange={(value) => set('chargeType', value as ZoneForm['chargeType'])}
                  options={[
                    { value: 'FREE', label: 'Free' },
                    { value: 'PAID', label: 'Paid' },
                  ]}
                />
              )}
            </FormField>

            <FormField
              label="Fee (₹)"
              hint={
                form.chargeType === 'PAID'
                  ? 'Blank uses the global default.'
                  : 'Only applies to a paid zone.'
              }
            >
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="number"
                  min={0}
                  inputMode="numeric"
                  disabled={form.chargeType !== 'PAID'}
                  value={form.fee}
                  onChange={(event) => set('fee', event.target.value)}
                  placeholder="100"
                />
              )}
            </FormField>
          </>
        )}
      </div>

      {/*
        Said on the screen where it changes the outcome, not only in the docs. Terrain comes from
        the DROP POINT landing inside this polygon — the route is never measured — so a plains
        destination reached only by climbing prices as PLAIN and the driver is underpaid for the
        hardest part of the job. Covering the approach road is the mitigation, and it is a
        drawing decision (docs/LLD/packages.md §Terrain).
      */}
      {type === 'HILL' && (
        <p className="flex items-start gap-1.5 text-xs text-text-subtle border border-border rounded-md p-2">
          <Mountain aria-hidden className="size-3.5 shrink-0 mt-px" />
          This edge is a price boundary. Draw over the approach corridor, not just the summit towns
          — if a destination is reached through the hills, the road to it belongs inside.
        </p>
      )}

      <div className="flex items-center gap-4 text-xs text-text-subtle tabular-nums">
        <span>
          Area <span className="text-text">{validation.areaKm2.toFixed(2)} km²</span>
        </span>
        <span>
          Vertices <span className="text-text">{validation.vertexCount}</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          icon={<Upload aria-hidden className="size-3.5" />}
          onClick={onImport}
        >
          Import GeoJSON
        </Button>
      </div>

      <ZoneViolations
        violations={validation.violations}
        confirming={validation.confirming}
        empty={draft === null}
        onShowOnMap={onShowOnMap}
      />

      {/*
        Said before the click, not after. A geometry save never mutates the row — it inserts a
        new version and supersedes the old one — and an admin who does not know that will not
        understand why the version number moved or why the old boundary is still queryable.
      */}
      {!creating && (
        <p className="text-xs text-text-subtle">
          Saving creates version {(zone?.version ?? 0) + 1}. The current one is kept, deactivated,
          for the bookings that resolved against it.
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <Button size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={onSave} disabled={blocked} loading={saving}>
          {creating ? 'Create zone' : 'Save boundary'}
        </Button>
      </div>
    </>
  );
}
