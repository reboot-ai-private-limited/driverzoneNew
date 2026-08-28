'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Plus, TriangleAlert } from 'lucide-react';
import { TERRAINS, type OutstationPackageDto, type Terrain } from '@driverzone/contracts';
import {
  Button,
  CellStack,
  DataTable,
  EmptyState,
  Panel,
  StatusPill,
  type Column,
} from '@driverzone/design-system';
import { formatPaise } from '@/lib/format';
import { bpsToPercent } from '../lib/money';
import { buildCoverage, formatBand, ladderFor, type CoverageSegment } from '../lib/band';
import { SplitBandDialog } from './SplitBandDialog';

/**
 * The outstation list: one row per band, with the GAPS between them interleaved as rows.
 *
 * This was a proportional coverage ladder. It became a table when pricing by car category was
 * retired — a band used to hide ten price rows behind it and had nothing readable to put in a
 * cell, so a strip was the only way to show anything at all. A band is now two fares and a
 * percentage, which fits a row, and a row is the more legible of the two.
 *
 * WHAT DID NOT CHANGE IS THE GAP. `buildCoverage` still computes it, and it is still the only
 * guard against one (docs/LLD/packages.md §Overlap): an overlap is refused at write time, caught
 * again by the nightly job, and made deterministic by read-time precedence, while a gap is
 * caught by nobody because nothing is wrong with any individual band. It is rendered as a red
 * row that offers to fill itself.
 *
 * INACTIVE BANDS NEED THE SECOND TABLE. Coverage is computed from active bands only, matching
 * the server's `isActive: true` overlap filter, so an inactive band correctly appears in no row
 * above. Without somewhere else to live it would be unreachable, and "deactivate" would read as
 * "delete" for a route that has no DELETE.
 */

export interface OutstationViewProps {
  packages: OutstationPackageDto[];
  refetching: boolean;
}

const TERRAIN_LABELS: Record<Terrain, string> = { PLAIN: 'Plains', HILL: 'Hills' };

/** A band row, or the hole before it. One list so the table reads in distance order. */
type Row =
  | { kind: 'band'; key: string; terrain: Terrain; band: OutstationPackageDto }
  | { kind: 'gap'; key: string; terrain: Terrain; segment: CoverageSegment };

const COLUMN_WIDTHS = ['w-24', 'w-64', 'w-32', 'w-32', 'w-24', 'w-40'];

export function OutstationView({ packages, refetching }: OutstationViewProps) {
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const [splitting, setSplitting] = useState<OutstationPackageDto | undefined>(undefined);

  const inactive = packages.filter((pkg) => !pkg.is_active);

  const rows = useMemo<Row[]>(() => {
    const byId = new Map(packages.map((pkg) => [pkg.id, pkg]));
    return TERRAINS.flatMap((terrain) =>
      buildCoverage(ladderFor(packages, terrain)).flatMap<Row>((segment) => {
        if (segment.kind === 'gap') {
          return [{ kind: 'gap', key: `${terrain}-gap-${segment.from}`, terrain, segment }];
        }
        const band = segment.packageId === undefined ? undefined : byId.get(segment.packageId);
        return band === undefined ? [] : [{ kind: 'band', key: band.id, terrain, band }];
      }),
    );
  }, [packages]);

  if (packages.length === 0) {
    return (
      <EmptyState
        title="No outstation bands yet"
        description="Every outstation quote resolves to a distance band. Until one exists, every outstation trip returns NO_PACKAGE_FOR_DISTANCE and we decline the booking."
        action={
          <Button
            variant="primary"
            size="sm"
            onClick={() => router.push('/packages/outstation/new')}
          >
            Create the first band
          </Button>
        }
      />
    );
  }

  const columns: Column<Row>[] = [
    {
      key: 'terrain',
      header: 'Terrain',
      width: COLUMN_WIDTHS[0] as string,
      render: (row) => <StatusPill status={TERRAIN_LABELS[row.terrain]} />,
    },
    {
      key: 'band',
      header: 'Distance',
      width: COLUMN_WIDTHS[1] as string,
      render: (row) =>
        row.kind === 'band' ? (
          <CellStack primary={formatBand(row.band.min_km, row.band.max_km)} secondary={row.band.name} />
        ) : (
          <span className="flex items-center gap-1.5 text-danger font-medium">
            <TriangleAlert className="size-4 shrink-0" />
            {formatBand(row.segment.from, row.segment.to)}
          </span>
        ),
    },
    {
      key: 'oneWay',
      header: 'One-way',
      width: COLUMN_WIDTHS[2] as string,
      numeric: true,
      align: 'right',
      render: (row) => (row.kind === 'band' ? formatPaise(row.band.one_way_fare_paise) : <Dash />),
    },
    {
      key: 'return',
      header: 'Return',
      width: COLUMN_WIDTHS[3] as string,
      numeric: true,
      align: 'right',
      render: (row) => {
        if (row.kind !== 'band') return <Dash />;
        // Null is "not offered", never "free" — so it renders as a dash with a reason, not ₹0.
        return row.band.round_trip_fare_paise === null ? (
          <span className="text-text-subtle" title="Same-day return not offered on this band">
            —
          </span>
        ) : (
          formatPaise(row.band.round_trip_fare_paise)
        );
      },
    },
    {
      key: 'driver',
      header: 'Driver',
      width: COLUMN_WIDTHS[4] as string,
      numeric: true,
      align: 'right',
      render: (row) =>
        row.kind === 'band' ? `${bpsToPercent(row.band.driver_commission_bps)}%` : <Dash />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: COLUMN_WIDTHS[5] as string,
      align: 'right',
      render: (row) =>
        row.kind === 'band' ? (
          <div className="flex items-center justify-end gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                router.push(`/packages/outstation/${row.band.id}`);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                setSplitting(row.band);
              }}
            >
              Split
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-4" />}
            onClick={(event) => {
              event.stopPropagation();
              router.push(gapHref(row.terrain, row.segment));
            }}
          >
            Add band
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        refetching={refetching}
        onRowClick={(row) =>
          router.push(
            row.kind === 'band'
              ? `/packages/outstation/${row.band.id}`
              : gapHref(row.terrain, row.segment),
          )
        }
      />

      <p className="text-xs text-text-subtle max-w-3xl">
        Bands are half-open, so <strong className="font-medium text-text">70–100</strong> starts
        where <strong className="font-medium text-text">0–70</strong> ends and 70 km belongs to
        the second. The fare is flat across a band — 72 km and 98 km both pay the same. Hills and
        plains are independent ladders; the same range on both is the expected setup, not a
        conflict. A red row is a distance nobody has priced, and we decline those trips.
      </p>

      {inactive.length > 0 && (
        <Panel
          flush
          title={
            <button
              type="button"
              onClick={() => setShowInactive((open) => !open)}
              className="flex items-center gap-1.5 text-sm font-medium text-text"
              aria-expanded={showInactive}
            >
              {showInactive ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
              Inactive bands ({inactive.length})
            </button>
          }
        >
          {showInactive && (
            <InactiveTable
              packages={inactive}
              refetching={refetching}
              onOpen={(id) => router.push(`/packages/outstation/${id}`)}
            />
          )}
        </Panel>
      )}

      {splitting !== undefined && (
        <SplitBandDialog
          band={splitting}
          open
          onOpenChange={(open) => {
            if (!open) setSplitting(undefined);
          }}
        />
      )}
    </div>
  );
}

function Dash() {
  return <span className="text-text-subtle">—</span>;
}

/**
 * The gap's range, carried into the create form.
 *
 * `maxKm` is omitted for the open tail — there is no upper bound to pre-fill, and guessing one
 * would put a number in a field the admin then has to notice and correct.
 */
function gapHref(terrain: Terrain, segment: CoverageSegment): string {
  const params = new URLSearchParams({ terrain, minKm: String(segment.from) });
  if (segment.to !== null) params.set('maxKm', String(segment.to));
  return `/packages/outstation/new?${params.toString()}`;
}

interface InactiveTableProps {
  packages: OutstationPackageDto[];
  refetching: boolean;
  onOpen: (id: string) => void;
}

function InactiveTable({ packages, refetching, onOpen }: InactiveTableProps) {
  const columns: Column<OutstationPackageDto>[] = [
    {
      key: 'name',
      header: 'Band',
      width: 'w-72',
      render: (pkg) => (
        <CellStack primary={pkg.name} secondary={formatBand(pkg.min_km, pkg.max_km)} />
      ),
    },
    {
      key: 'terrain',
      header: 'Terrain',
      width: 'w-32',
      render: (pkg) => <StatusPill status={TERRAIN_LABELS[pkg.terrain]} />,
    },
    {
      key: 'oneWay',
      header: 'One-way',
      width: 'w-32',
      numeric: true,
      align: 'right',
      render: (pkg) => formatPaise(pkg.one_way_fare_paise),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: 'w-24',
      align: 'right',
      render: (pkg) => (
        <Button
          size="sm"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(pkg.id);
          }}
        >
          Edit
        </Button>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={packages}
      rowKey={(pkg) => pkg.id}
      refetching={refetching}
      onRowClick={(pkg) => onOpen(pkg.id)}
    />
  );
}
