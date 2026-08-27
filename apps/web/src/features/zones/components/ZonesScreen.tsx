'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { List, Map as MapIcon } from 'lucide-react';
import type { PickupChargeType, ZoneDto, ZoneType } from '@driverzone/contracts';
import type { Polygon } from '@driverzone/geo';
import {
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  TopProgressBar,
  cn,
} from '@driverzone/design-system';
import { ApiError } from '@/lib/api/ApiError';
import { toErrorState } from '@/lib/api/toErrorState';
import { useFilterParams } from '@/lib/hooks/useFilterParams';
import { useZones } from '../hooks/useZones';
import { useIncityPackages } from '../hooks/useIncityPackages';
import { useZoneValidation } from '../hooks/useZoneValidation';
import {
  useCreateZone,
  useUpdateZoneGeometry,
  useUpdateZoneMetadata,
} from '../hooks/useZoneMutations';
import { toGeoJsonExport } from '../lib/geojson-import';
import { hasApiKey, type MapTypeId } from '../lib/google-maps';
import { DeactivateZoneDialog } from './DeactivateZoneDialog';
import { PlaceSearch } from './PlaceSearch';
import { GeoJsonImportDialog } from './GeoJsonImportDialog';
import { ZoneInspector, type ZoneForm } from './ZoneInspector';
import { ZoneRail } from './ZoneRail';
import { ZonesTable } from './ZonesTable';

/**
 * Coverage — the zones screen.
 *
 * ONE SCREEN, TWO VIEWS, AND THE MAP IS THE DEFAULT. The table this replaced was not wrong
 * because it was a table; it was wrong because it rendered three different kinds of thing as
 * one kind of row. A CITY zone is a setting (there is exactly one, operationally), a PICKUP
 * zone is one of a fixed pair, and a HILL zone is one of a growing list — and the `pickup_charge`
 * column being `—` on five rows out of seven was that mismatch showing through.
 *
 * The list view survives as the AUDIT surface, where superseded versions and inactive zones
 * live. See `ZonesTable`.
 *
 * State that a colleague might need to see lives in the URL — the view, the selection — so a
 * link to "the zone I am asking you about" is a link and not a description. Editor state
 * (the draft polygon, the form) deliberately does not: a half-drawn boundary is not something
 * to restore from a bookmark.
 */

/**
 * MapLibre and Draw are ~210 kB of the zones route on their own, and NOTHING else in the panel
 * needs them — nor does this screen's own list view. Loading them per route (which is what Next
 * is still buying us, per docs/engineering/frontend-architecture.md) is not granular enough
 * when the heavy thing is one of two views.
 *
 * `ssr: false` is the other half. MapLibre reaches for browser globals at module scope; there
 * is no server render of a WebGL canvas worth having, and prerendering it only risks the kind
 * of failure that shows up in production and not in `next dev`.
 */
const ZoneMap = dynamic(() => import('./ZoneMap').then((module) => module.ZoneMap), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-surface-muted" />,
});

type FilterKey = 'view' | 'zone';

interface EditSession {
  /** `null` when creating — there is no saved zone behind the draft yet. */
  zoneId: string | null;
  type: ZoneType;
}

const BLANK_FORM: ZoneForm = { name: '', code: '', chargeType: 'FREE', fee: '' };

function formFor(zone: ZoneDto): ZoneForm {
  return {
    name: zone.name,
    code: zone.code,
    chargeType: zone.pickup_charge_type ?? 'NONE',
    // Paise on the wire, rupees in the field. An empty string is "use the global default",
    // which is a different thing from zero and must survive the round trip as such.
    fee: zone.pickup_charge_paise == null ? '' : String(zone.pickup_charge_paise / 100),
  };
}

export function ZonesScreen() {
  const params = useFilterParams<FilterKey>();
  const view = params.get('view') === 'list' ? 'list' : 'map';
  const selectedId = params.get('zone') || null;

  const [session, setSession] = useState<EditSession | null>(null);
  const [draft, setDraft] = useState<Polygon | null>(null);
  const [form, setForm] = useState<ZoneForm>(BLANK_FORM);
  const [mapType, setMapType] = useState<MapTypeId>('roadmap');
  const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [violationFocus, setViolationFocus] = useState<Polygon | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<ZoneDto | null>(null);

  const zonesQuery = useZones();
  const packagesQuery = useIncityPackages();

  const zones = useMemo(() => zonesQuery.data?.zones ?? [], [zonesQuery.data]);
  const selected = zones.find((zone) => zone.id === selectedId) ?? null;
  const editing = session !== null;

  const select = useCallback(
    (id: string | null) => {
      params.set({ zone: id ?? undefined });
      setViolationFocus(null);
    },
    [params],
  );

  const validation = useZoneValidation({
    geometry: editing ? draft : (selected?.geometry ?? null),
    type: session?.type ?? selected?.type ?? 'PICKUP',
    zones,
    ...(session?.zoneId == null ? {} : { excludeZoneId: session.zoneId }),
    enabled: editing,
  });

  const create = useCreateZone((zone) => {
    setSession(null);
    setDraft(null);
    select(zone.id);
  });
  const updateMetadata = useUpdateZoneMetadata();
  const updateGeometry = useUpdateZoneGeometry((zone) => {
    setSession(null);
    setDraft(null);
    // A geometry save inserts a NEW document — the id changes with the version. Re-selecting
    // the returned zone is what stops the screen pointing at the row it just superseded.
    select(zone.id);
  });

  const saving = create.isPending || updateGeometry.isPending || updateMetadata.isPending;

  const startCreate = (type: 'PICKUP' | 'HILL'): void => {
    select(null);
    setSession({ zoneId: null, type });
    setDraft(null);
    setForm({ ...BLANK_FORM, chargeType: type === 'PICKUP' ? 'FREE' : 'NONE' });
  };

  const startEdit = (zone: ZoneDto): void => {
    select(zone.id);
    setSession({ zoneId: zone.id, type: zone.type });
    setDraft(zone.geometry);
    setForm(formFor(zone));
    setFitToken((token) => token + 1);
  };

  const cancel = (): void => {
    setSession(null);
    setDraft(null);
    setViolationFocus(null);
  };

  const chargeFields = (): { charge_type?: PickupChargeType; charge_paise?: number | null } => {
    if (session?.type !== 'PICKUP' || form.chargeType === 'NONE') return {};
    const rupees = form.fee.trim();
    return {
      charge_type: form.chargeType,
      // Blank is `null` — "fall back to the global default" — and never 0, which would mean a
      // paid zone that charges nothing and would silently undercut the default the day ops
      // changes it.
      charge_paise:
        form.chargeType === 'PAID' && rupees !== '' ? Math.round(Number(rupees) * 100) : null,
    };
  };

  const save = (): void => {
    if (draft === null || session === null) return;
    const { charge_type, charge_paise } = chargeFields();

    if (session.zoneId === null) {
      create.mutate({
        type: session.type,
        name: form.name.trim(),
        code: form.code.trim(),
        geometry: draft,
        ...(charge_type === undefined ? {} : { pickup_charge_type: charge_type }),
        ...(charge_paise === undefined ? {} : { pickup_charge_paise: charge_paise }),
      });
      return;
    }

    const zone = zones.find((candidate) => candidate.id === session.zoneId);
    if (zone === undefined) return;

    /**
     * METADATA FIRST, THEN GEOMETRY, AND THE ORDER IS LOAD-BEARING.
     *
     * `replaceGeometry` copies name, code, priority and charge from the row it supersedes onto
     * the new version. Patching metadata AFTER the geometry save would therefore write to the
     * old id and be lost, and the new version would silently carry the old name — a rename that
     * appears to succeed and did not.
     */
    const metadataChanged =
      form.name.trim() !== zone.name ||
      form.code.trim() !== zone.code ||
      charge_type !== zone.pickup_charge_type ||
      (charge_paise ?? null) !== (zone.pickup_charge_paise ?? null);

    const commitGeometry = (): void => {
      updateGeometry.mutate(
        { id: zone.id, geometry: draft, expectedVersion: zone.version },
        {
          onError: (error) => {
            // The one write here that can fail because of somebody else. The toast already
            // carries the server's wording; what the UI owes on top of it is to leave the edit
            // mode holding a version number that is now provably stale.
            if (error instanceof ApiError && error.code === 'ZONE_ALREADY_SUPERSEDED') cancel();
          },
        },
      );
    };

    if (!metadataChanged) {
      commitGeometry();
      return;
    }

    updateMetadata.mutate(
      {
        id: zone.id,
        patch: {
          name: form.name.trim(),
          code: form.code.trim(),
          ...(charge_type === undefined ? {} : { pickup_charge_type: charge_type }),
          ...(charge_paise === undefined ? {} : { pickup_charge_paise: charge_paise }),
        },
      },
      { onSuccess: commitGeometry },
    );
  };

  const exportSelected = (): void => {
    if (selected === null) return;
    void navigator.clipboard.writeText(
      toGeoJsonExport(selected.name, selected.code, selected.geometry),
    );
  };

  const errorState = zonesQuery.isError
    ? toErrorState(zonesQuery.error, () => void zonesQuery.refetch())
    : undefined;

  return (
    <>
      <PageHeader
        title="Zones"
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Zones' }]}
        actions={
          <SegmentedControl
            label="View"
            value={view}
            onValueChange={(next) => params.set({ view: next === 'map' ? undefined : next })}
            segments={[
              { value: 'map', label: 'Map', icon: <MapIcon aria-hidden className="size-3.5" /> },
              { value: 'list', label: 'List', icon: <List aria-hidden className="size-3.5" /> },
            ]}
          />
        }
      />

      {view === 'list' ? (
        <ZonesTable
          zones={zones}
          loading={zonesQuery.isLoading}
          refetching={zonesQuery.isFetching && !zonesQuery.isLoading}
          error={errorState}
          onSelect={(id) => {
            select(id);
            params.set({ view: undefined });
          }}
        />
      ) : (
        <section className="bg-surface border border-border rounded-md overflow-hidden">
          {/* A background refetch dims nothing and blanks nothing — the polygon an admin is
              editing must not vanish because a poll came back. */}
          <TopProgressBar active={zonesQuery.isFetching && !zonesQuery.isLoading} />

          {zonesQuery.isLoading ? (
            <div className="flex">
              <div className="w-80 shrink-0 border-r border-border p-4 flex flex-col gap-3">
                {Array.from({ length: 5 }, (_, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Skeleton key={index} className="h-16 rounded-md" />
                ))}
              </div>
              <Skeleton className="flex-1 h-[32rem] rounded-none" />
            </div>
          ) : errorState !== undefined ? (
            <div className="p-6">
              <ErrorState {...errorState} />
            </div>
          ) : (
            <div className="flex min-h-[36rem]">
              {/* The rail is the accessible path through this screen: every zone by name, with
                  the same selection state the map has. The map itself has no text alternative
                  worth writing. */}
              <div
                className={cn(
                  'w-80 shrink-0 border-r border-border transition-opacity',
                  editing && 'opacity-40 pointer-events-none',
                )}
              >
                <ZoneRail
                  zones={zones}
                  packages={packagesQuery.data?.packages}
                  selectedId={selectedId}
                  onSelect={select}
                  onEditGeometry={startEdit}
                  onCreate={startCreate}
                  busy={editing}
                />
              </div>

              <div className="flex-1 flex flex-col min-w-0">
                <div className="relative flex-1 min-h-[24rem]">
                  {!hasApiKey ? (
                    <MissingKeyNotice />
                  ) : (
                    <>
                      <ZoneMap
                        zones={zones}
                        selectedId={selectedId}
                        onSelect={select}
                        editing={editing}
                        draft={draft}
                        onDraftChange={setDraft}
                        violationGeometry={violationFocus}
                        mapType={mapType}
                        fitToken={fitToken}
                        onMapReady={setMapInstance}
                      />

                      {/*
                    Map type, and the three are not interchangeable.
                    HYBRID is imagery WITH road labels, and it is the one that answers the
                    question a pickup boundary actually asks — where the built-up area ends, and
                    what road that is. Neither layer alone answers it.
                    TERRAIN carries shaded relief, for hill zones: their edges are price
                    boundaries that must cover the approach corridor, and relief is what shows
                    where the corridor runs.
                    ROADMAP is the default because it is the least visually noisy to select on.
                  */}
                      <div className="absolute top-2 left-2 flex items-center gap-2">
                        <SegmentedControl
                          label="Map type"
                          value={mapType}
                          onValueChange={setMapType}
                          segments={[
                            { value: 'roadmap', label: 'Map' },
                            { value: 'hybrid', label: 'Satellite' },
                            { value: 'terrain', label: 'Terrain' },
                          ]}
                        />
                        {/* Search moves the viewport only — never the draft. */}
                        <PlaceSearch map={mapInstance} />
                      </div>
                    </>
                  )}
                </div>

                <div className="border-t border-border">
                  <ZoneInspector
                    mode={editing ? 'edit' : 'view'}
                    zone={session?.zoneId == null ? (editing ? null : selected) : selected}
                    type={session?.type ?? selected?.type ?? 'PICKUP'}
                    form={form}
                    onFormChange={setForm}
                    draft={editing ? draft : (selected?.geometry ?? null)}
                    validation={validation}
                    saving={saving}
                    onEditGeometry={() => selected !== null && startEdit(selected)}
                    onImport={() => setImportOpen(true)}
                    onExport={exportSelected}
                    onDeactivate={() => setDeactivating(selected)}
                    onShowOnMap={(geometry) => {
                      setViolationFocus(geometry);
                      setFitToken((token) => token + 1);
                    }}
                    onCancel={cancel}
                    onSave={save}
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      <GeoJsonImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(polygon) => {
          // Importing outside an edit session starts one, so a paste is never a change the
          // admin cannot see before it is saved.
          if (session === null && selected !== null) startEdit(selected);
          setDraft(polygon);
          setFitToken((token) => token + 1);
        }}
      />

      <DeactivateZoneDialog
        zone={deactivating}
        onOpenChange={(open) => !open && setDeactivating(null)}
        onDeactivated={() => select(null)}
      />
    </>
  );
}

/**
 * No API key. A blank grey rectangle would read as a broken map — this says which variable is
 * missing and what it needs, because the person hitting it is a developer on a fresh checkout,
 * not an admin.
 *
 * The rest of the screen keeps working: the rail lists every zone, the inspector shows its
 * metadata and area, and the List view is entirely unaffected. Only drawing needs the map.
 */
function MissingKeyNotice() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface-muted p-6">
      <div className="max-w-sm text-center flex flex-col gap-2">
        <p className="text-sm font-medium text-text">The map needs an API key</p>
        <p className="text-xs text-text-subtle">
          Set <code className="text-text">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> and rebuild — it is
          inlined at build time, so a restart alone will not pick it up. Restrict the key by HTTP
          referrer and to the Maps JavaScript and Places APIs before deploying it.
        </p>
        <p className="text-xs text-text-subtle">
          Everything else on this screen works without it, except drawing a boundary.
        </p>
      </div>
    </div>
  );
}
