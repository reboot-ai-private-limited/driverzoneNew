'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import type { IncityPackageDto } from '@driverzone/contracts';
import { Button, CellStack, DataTable, StatusPill, type Column } from '@driverzone/design-system';
import { formatPaise } from '@/lib/format';

/**
 * The InCity list. An ordinary table, unlike the outstation tab.
 *
 * The two products get different shapes because they fail differently. An outstation band can
 * leave a hole in the distance ladder that nothing else reports, so its list interleaves gap
 * rows. An incity package cannot: it sells against the city zone, and the failure worth
 * surfacing here is the opposite one — TWO active packages against the same zone.
 */

/** Shared with the skeleton so the page does not jump when the rows land. */
export const INCITY_COLUMN_WIDTHS = ['w-72', 'w-40', 'w-24', 'w-28', 'w-28', 'w-24'];

export interface IncityTableProps {
  packages: IncityPackageDto[];
  refetching: boolean;
}

export function IncityTable({ packages, refetching }: IncityTableProps) {
  const router = useRouter();

  /**
   * City zones with more than one ACTIVE package, and which of them a quote would pick.
   *
   * The schema allows many packages per zone and `domain-model.md` §Cardinality deliberately
   * refuses to hard-code the singleton, so this is legal. It is also ambiguous: the resolver has
   * to fall through to its precedence ladder, which `packages.md` describes as resolving "a
   * configuration error P-2 should have prevented". Forbidding it would reverse a documented
   * decision; saying nothing would leave ops unable to explain why one package's prices are the
   * ones customers see. So it is a warning that names the winner.
   *
   * The winner is computed the way the server does — cheapest active variant, then most recently
   * created — and never on the wire, so it stays a UI concern.
   */
  const ambiguous = useMemo(() => {
    const byZone = new Map<string, IncityPackageDto[]>();
    for (const pkg of packages) {
      if (!pkg.is_active) continue;
      byZone.set(pkg.city_zone_id, [...(byZone.get(pkg.city_zone_id) ?? []), pkg]);
    }
    return [...byZone.entries()]
      .filter(([, group]) => group.length > 1)
      .map(([zoneId, group]) => ({ zoneId, group, winner: pickWinner(group) }));
  }, [packages]);

  const columns: Column<IncityPackageDto>[] = [
    {
      key: 'name',
      header: 'Package',
      width: INCITY_COLUMN_WIDTHS[0] as string,
      render: (pkg) => (
        <CellStack
          primary={pkg.name}
          {...(pkg.description === undefined ? {} : { secondary: pkg.description })}
        />
      ),
    },
    {
      key: 'from',
      header: 'From',
      width: INCITY_COLUMN_WIDTHS[1] as string,
      numeric: true,
      align: 'right',
      // The cheapest active variant — what a customer sees first, and what the resolver compares.
      render: (pkg) => {
        const cheapest = cheapestFare(pkg);
        return cheapest === null ? (
          <span className="text-text-subtle">—</span>
        ) : (
          formatPaise(cheapest)
        );
      },
    },
    {
      key: 'variants',
      header: 'Variants',
      width: INCITY_COLUMN_WIDTHS[2] as string,
      numeric: true,
      align: 'right',
      render: (pkg) => pkg.variants.filter((variant) => variant.is_active).length,
    },
    {
      key: 'status',
      header: 'Status',
      width: INCITY_COLUMN_WIDTHS[3] as string,
      render: (pkg) => <StatusPill status={pkg.is_active ? 'ACTIVE' : 'INACTIVE'} />,
    },
    {
      key: 'wins',
      header: <span className="sr-only">Ambiguity</span>,
      width: INCITY_COLUMN_WIDTHS[4] as string,
      render: (pkg) => {
        const clash = ambiguous.find((entry) => entry.group.some((other) => other.id === pkg.id));
        if (clash === undefined) return null;
        return clash.winner?.id === pkg.id ? (
          <span className="text-xs text-text-subtle">quotes use this</span>
        ) : (
          <span className="text-xs text-warning">shadowed</span>
        );
      },
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: INCITY_COLUMN_WIDTHS[5] as string,
      align: 'right',
      render: (pkg) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            router.push(`/packages/incity/${pkg.id}`);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {ambiguous.map((entry) => (
        <p
          key={entry.zoneId}
          className="flex items-start gap-2 text-xs text-warning border border-warning/40 bg-warning/10 rounded-md px-3 py-2"
        >
          <TriangleAlert className="size-4 shrink-0 mt-px" />
          <span>
            {entry.group.length} active packages sell against the same city zone. A quote returns
            only one — <strong className="font-medium">{entry.winner?.name}</strong>, because it
            has the cheapest active variant. Deactivate the others, or expect prices nobody chose.
          </span>
        </p>
      ))}

      <DataTable
        columns={columns}
        rows={packages}
        rowKey={(pkg) => pkg.id}
        refetching={refetching}
        onRowClick={(pkg) => router.push(`/packages/incity/${pkg.id}`)}
      />
    </div>
  );
}

/** The cheapest ACTIVE variant's base fare, or `null` for a package with none. */
function cheapestFare(pkg: IncityPackageDto): number | null {
  const fares = pkg.variants.filter((v) => v.is_active).map((v) => v.base_fare_paise);
  return fares.length === 0 ? null : Math.min(...fares);
}

/** Rung (c) then (d), as `resolveForTrip` applies them: cheapest, then most recent. */
function pickWinner(group: IncityPackageDto[]): IncityPackageDto | undefined {
  return [...group].sort((a, b) => (cheapestFare(a) ?? Infinity) - (cheapestFare(b) ?? Infinity))[0];
}
