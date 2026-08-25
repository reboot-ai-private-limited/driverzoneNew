'use client';

import { useMemo, useState } from 'react';
import { Building2 } from 'lucide-react';
import type { ZoneDto, ZoneType } from '@driverzone/contracts';
/**
 * The SAME function the API reports `stats` from on POST /admin/zones/validate. Area and
 * vertex count are computed in the browser rather than fetched, and cannot disagree with the
 * server because it is not a second implementation — it is the same one. That property is the
 * entire reason @driverzone/geo is a package (docs/engineering/shared-packages.md), and this
 * list is its first web consumer.
 */
import { zoneStats } from '@driverzone/geo';
import {
  Badge,
  CellStack,
  DataState,
  DataTable,
  FilterBar,
  FilterField,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SkeletonTable,
  StatusPill,
  TopProgressBar,
  type Column,
  type SortState,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { useZones } from '../hooks/useZones';

const PAGE_SIZE = 15;

/** The skeleton uses the SAME widths as the columns, so nothing shifts when the data lands. */
const COLUMN_WIDTHS = ['w-64', 'w-24', 'w-24', 'w-24', 'w-20', 'w-16', 'w-20'];

export function ZonesScreen() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'ALL' | ZoneType>('ALL');
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  const [page, setPage] = useState(1);

  const query = useZones();

  /**
   * Filtering, sorting and paging happen in the browser because `GET /admin/zones` returns the
   * whole set — there is no page parameter in `ListZonesQuery`, and there should not be yet:
   * a city has tens of zones, not thousands. When that stops being true this moves server-side
   * and the component's props do not change.
   */
  const filtered = useMemo(() => {
    const zones = query.data?.zones ?? [];
    const needle = search.trim().toLowerCase();

    const matching = zones.filter(
      (zone) =>
        (type === 'ALL' || zone.type === type) &&
        (needle === '' ||
          zone.name.toLowerCase().includes(needle) ||
          zone.code.toLowerCase().includes(needle)),
    );

    return [...matching].sort((a, b) => {
      const direction = sort.direction === 'asc' ? 1 : -1;
      if (sort.key === 'area')
        return (zoneStats(a.geometry).areaKm2 - zoneStats(b.geometry).areaKm2) * direction;
      if (sort.key === 'version') return (a.version - b.version) * direction;
      if (sort.key === 'type') return a.type.localeCompare(b.type) * direction;
      return a.name.localeCompare(b.name) * direction;
    });
  }, [query.data, search, type, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const columns: Column<ZoneDto>[] = [
    {
      key: 'name',
      header: 'Zone',
      width: COLUMN_WIDTHS[0] ?? '',
      sortable: true,
      render: (zone) => <CellStack primary={zone.name} secondary={zone.code} />,
    },
    {
      key: 'type',
      header: 'Type',
      width: COLUMN_WIDTHS[1] ?? '',
      sortable: true,
      render: (zone) => <StatusPill status={zone.type} />,
    },
    {
      key: 'charge',
      header: 'Pickup charge',
      width: COLUMN_WIDTHS[2] ?? '',
      render: (zone) =>
        zone.pickup_charge_type === undefined ? (
          <span className="text-text-subtle">—</span>
        ) : (
          <CellStack
            primary={<StatusPill status={zone.pickup_charge_type} />}
            secondary={
              zone.pickup_charge_type === 'PAID' && zone.pickup_charge_paise == null
                ? 'global default'
                : undefined
            }
          />
        ),
    },
    {
      key: 'area',
      header: 'Area',
      width: COLUMN_WIDTHS[3] ?? '',
      align: 'right',
      numeric: true,
      sortable: true,
      render: (zone) => `${zoneStats(zone.geometry).areaKm2.toFixed(1)} km²`,
    },
    {
      key: 'vertices',
      header: 'Vertices',
      width: COLUMN_WIDTHS[4] ?? '',
      align: 'right',
      numeric: true,
      render: (zone) => zoneStats(zone.geometry).vertexCount,
    },
    {
      key: 'version',
      header: 'Ver',
      width: COLUMN_WIDTHS[5] ?? '',
      align: 'right',
      numeric: true,
      sortable: true,
      render: (zone) => zone.version,
    },
    {
      key: 'active',
      header: 'Status',
      width: COLUMN_WIDTHS[6] ?? '',
      render: (zone) => (
        <Badge tone={zone.is_active ? 'success' : 'neutral'}>
          {zone.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Zones" breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Zones' }]} />

      <FilterBar>
        <FilterField label="Search" className="flex-1 min-w-64">
          <SearchInput
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search by name or code"
          />
        </FilterField>
        <FilterField label="Type">
          <Select
            value={type}
            onValueChange={(value) => {
              setType(value as 'ALL' | ZoneType);
              setPage(1);
            }}
            options={[
              { value: 'ALL', label: 'All types' },
              { value: 'CITY', label: 'City' },
              { value: 'PICKUP', label: 'Pickup' },
              { value: 'HILL', label: 'Hill' },
            ]}
          />
        </FilterField>
      </FilterBar>

      <section className="bg-surface border border-border rounded-md overflow-hidden">
        {/* A background refetch dims the rows and shows this. It never replaces them with
            skeletons — the row an admin is reading must not vanish. */}
        <TopProgressBar active={query.isFetching && !query.isLoading} />

        <DataState
          loading={query.isLoading}
          error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
          empty={filtered.length === 0}
          emptyState={{
            icon: <Building2 aria-hidden className="size-6" />,
            title: query.data?.zones.length === 0 ? 'No zones yet' : 'No zones match those filters',
            description:
              query.data?.zones.length === 0
                ? 'Draw a city boundary and at least one pickup zone before anything can be booked.'
                : 'Try a different type, or clear the search.',
          }}
          skeleton={<SkeletonTable rows={10} columns={COLUMN_WIDTHS} />}
        >
          <DataTable
            columns={columns}
            rows={visible}
            rowKey={(zone) => zone.id}
            sort={sort}
            onSortChange={setSort}
            refetching={query.isFetching && !query.isLoading}
          />
          <Pagination
            page={page}
            pageCount={pageCount}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
        </DataState>
      </section>
    </>
  );
}
