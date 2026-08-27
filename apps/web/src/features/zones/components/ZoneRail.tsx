'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, ArrowUpRight, Mountain, Pencil, Plus } from 'lucide-react';
import Link from 'next/link';
import type { IncityPackageDto, ZoneDto } from '@driverzone/contracts';
import { zoneStats } from '@driverzone/geo';
import { Badge, Button, StatusPill, cn } from '@driverzone/design-system';
import { packagesForZone } from '../hooks/useIncityPackages';
import { pickupCoverageOfCity } from '../lib/coverage';

/**
 * The rail is the answer to "why was the table wrong".
 *
 * A table renders every zone as the same kind of row, and the three types are not the same kind
 * of thing — which was already visible in the old table's `pickup_charge` column being `—` for
 * five rows out of seven. Sparse columns mean sparse ENTITIES.
 *
 *   CITY    exactly one, operationally. A SETTING, so it renders as a single card with no add
 *           button — the absence of that button is the strongest statement the UI can make that
 *           this is not a collection, stronger than any label saying so.
 *   PICKUP  a small fixed pair, FREE and PAID, and the only thing an admin reads off them is
 *           which is which and how much of the city they cover.
 *   HILL    a genuine list, N and growing.
 *
 * Nothing in the schema forbids a second city and nothing in the code assumes one
 * (docs/LLD/zones.md §The Siliguri instance). What is missing is only the admin surface, and
 * the trigger to build it is a second CITY zone being drawn — at which point this card becomes
 * a switcher and everything below it is unchanged.
 */

export interface ZoneRailProps {
  zones: ZoneDto[];
  packages: IncityPackageDto[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEditGeometry: (zone: ZoneDto) => void;
  onCreate: (type: 'PICKUP' | 'HILL') => void;
  busy: boolean;
}

export function ZoneRail({
  zones,
  packages,
  selectedId,
  onSelect,
  onEditGeometry,
  onCreate,
  busy,
}: ZoneRailProps) {
  const active = zones.filter((zone) => zone.is_active);
  const city = active.find((zone) => zone.type === 'CITY');
  const pickups = active.filter((zone) => zone.type === 'PICKUP');
  const hills = active.filter((zone) => zone.type === 'HILL');

  return (
    <div className="flex flex-col gap-5 overflow-y-auto p-4">
      <CityCard
        city={city}
        packages={packages}
        selected={city !== undefined && city.id === selectedId}
        onSelect={onSelect}
        onEditGeometry={onEditGeometry}
      />

      <Section
        title="Pickup"
        count={pickups.length}
        caption={<PickupCaption city={city} pickups={pickups} />}
        onAdd={() => onCreate('PICKUP')}
        addLabel="Pickup zone"
        busy={busy}
        empty="No pickup zone. Nothing can be booked — a pickup point must fall inside one."
      >
        {pickups.map((zone) => (
          <ZoneRow
            key={zone.id}
            zone={zone}
            selected={zone.id === selectedId}
            onSelect={onSelect}
            trailing={
              zone.pickup_charge_type === undefined ? null : (
                <StatusPill status={zone.pickup_charge_type} />
              )
            }
          />
        ))}
      </Section>

      <Section
        title="Hill"
        count={hills.length}
        caption={
          <span>
            A hill zone&rsquo;s edge is a price boundary — terrain comes from the drop point landing
            inside it.
          </span>
        }
        onAdd={() => onCreate('HILL')}
        addLabel="Hill zone"
        busy={busy}
        empty="No hill zones. Every outstation trip prices as PLAIN until one is drawn."
      >
        {hills.map((zone) => (
          <ZoneRow
            key={zone.id}
            zone={zone}
            selected={zone.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </Section>
    </div>
  );
}

/**
 * The city, as a card rather than a row. Note what is NOT here: an add button.
 *
 * The package line is the other half of the job. `cityZoneId` is the only zone reference either
 * product carries, and it is invisible on every other screen — so an admin looking at the city
 * boundary has no way to know what sells against it, and no way to know that deactivating it
 * takes those packages dark. A count of zero is a real alert state, not an empty list: it means
 * every incity quote returns NO_PACKAGE_AVAILABLE.
 *
 * The link goes to the packages screen and the editing stays there. Two screens owning one form
 * is how the two of them drift.
 */
function CityCard({
  city,
  packages,
  selected,
  onSelect,
  onEditGeometry,
}: {
  city: ZoneDto | undefined;
  packages: IncityPackageDto[] | undefined;
  selected: boolean;
  onSelect: (id: string) => void;
  onEditGeometry: (zone: ZoneDto) => void;
}) {
  if (city === undefined) {
    return (
      <section className="border border-border rounded-md p-3 flex flex-col gap-2">
        <SectionLabel>City boundary</SectionLabel>
        <p className="text-xs text-text-subtle">
          No city boundary yet. Until one exists there is no such thing as an incity trip — every
          quote resolves to outstation.
        </p>
      </section>
    );
  }

  const stats = zoneStats(city.geometry);
  const selling = packagesForZone(packages, city.id).filter((pkg) => pkg.is_active);

  return (
    <section
      className={cn(
        'border rounded-md p-3 flex flex-col gap-2 text-left',
        selected ? 'border-interactive bg-surface-muted' : 'border-border',
      )}
    >
      <SectionLabel>City boundary</SectionLabel>

      <button
        type="button"
        onClick={() => onSelect(city.id)}
        className="text-left flex flex-col gap-0.5"
      >
        <span className="text-sm font-semibold text-text">{city.name}</span>
        <span className="text-xs text-text-subtle tabular-nums">
          {city.code} · {stats.areaKm2.toFixed(1)} km² · v{city.version}
        </span>
      </button>

      <div className="border-t border-border pt-2 flex flex-col gap-1.5">
        <p className="text-xs text-text-subtle">Defines incity. Scopes the incity package.</p>
        {packages === undefined ? null : selling.length === 0 ? (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <AlertTriangle aria-hidden className="size-3.5 shrink-0 mt-0.5" />
            No active package sells against this city. Every hourly quote returns no availability.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {selling.map((pkg) => (
              <li key={pkg.id}>
                <Link
                  href="/packages"
                  className="inline-flex items-center gap-1 text-xs text-interactive hover:text-interactive-hover hover:underline"
                >
                  {pkg.name}
                  <ArrowUpRight aria-hidden className="size-3" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* "Edit boundary", never "New city". There is one, and the button says which verb applies. */}
      <Button
        size="sm"
        icon={<Pencil aria-hidden className="size-3.5" />}
        onClick={() => onEditGeometry(city)}
      >
        Edit boundary
      </Button>
    </section>
  );
}

function PickupCaption({ city, pickups }: { city: ZoneDto | undefined; pickups: ZoneDto[] }) {
  const coverage = pickupCoverageOfCity(city, pickups);
  if (coverage === null)
    return <span>The serviceability gate. A pickup outside every one is a trip we refuse.</span>;
  return (
    <span>
      <span className="tabular-nums font-medium text-text">{coverage}%</span> of {city?.name}{' '}
      covered
    </span>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-subtle">{children}</h3>
  );
}

function Section({
  title,
  count,
  caption,
  onAdd,
  addLabel,
  busy,
  empty,
  children,
}: {
  title: string;
  count: number;
  caption: ReactNode;
  onAdd: () => void;
  addLabel: string;
  busy: boolean;
  empty: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>
          {title} · <span className="tabular-nums">{count}</span>
        </SectionLabel>
      </div>
      <p className="text-xs text-text-subtle">{caption}</p>

      {count === 0 ? (
        <p className="text-xs text-warning border border-border rounded-md p-2">{empty}</p>
      ) : (
        <ul className="flex flex-col border border-border rounded-md divide-y divide-border overflow-hidden">
          {children}
        </ul>
      )}

      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        icon={<Plus aria-hidden className="size-3.5" />}
        onClick={onAdd}
        className="self-start"
      >
        {addLabel}
      </Button>
    </section>
  );
}

function ZoneRow({
  zone,
  selected,
  onSelect,
  trailing,
}: {
  zone: ZoneDto;
  selected: boolean;
  onSelect: (id: string) => void;
  trailing?: ReactNode;
}) {
  const stats = zoneStats(zone.geometry);

  return (
    <li>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(zone.id)}
        className={cn(
          'w-full text-left px-2.5 py-2 flex items-center justify-between gap-2',
          selected ? 'bg-surface-muted' : 'hover:bg-surface-muted',
        )}
      >
        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="text-sm text-text truncate">{zone.name}</span>
          <span className="text-xs text-text-subtle tabular-nums">
            {stats.areaKm2.toFixed(1)} km² · v{zone.version}
          </span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0">
          {trailing}
          {zone.type === 'HILL' && <Mountain aria-hidden className="size-3.5 text-text-subtle" />}
          {selected && <Badge tone="info">Selected</Badge>}
        </span>
      </button>
    </li>
  );
}
