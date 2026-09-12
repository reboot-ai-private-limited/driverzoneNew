'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Package as PackageIcon } from 'lucide-react';
import {
  Button,
  DataState,
  EmptyState,
  PageHeader,
  SegmentedControl,
  SkeletonTable,
  TopProgressBar,
} from '@driverzone/design-system';
import { toErrorState } from '@/lib/api/toErrorState';
import { useIncityPackages, useOutstationPackages } from '../hooks/usePackages';
import { IncityTable, INCITY_COLUMN_WIDTHS } from './IncityTable';
import { OutstationView } from './OutstationView';
import { TripResolutionPanel } from './TripResolutionPanel';

/**
 * The packages screen — what we actually sell, and what it costs.
 *
 * THE TABS ARE AN ADMIN AFFORDANCE ONLY. A customer never picks between incity and outstation:
 * the server decides from the two map points and returns exactly one package
 * (`packages.public.ts` → `resolveForTrip`). The split exists here because the two products have
 * genuinely disjoint shapes — incity is a set of duration variants sold against the city zone,
 * outstation is a one-way and a return fare against a terrain and a distance band — and one
 * table holding both would be a table where half the columns are blank on every row.
 *
 * The tab lives in React state rather than the URL. It is a view toggle, not a filter: nothing
 * on either side is worth deep-linking, and the editors have their own routes.
 */

type Tab = 'INCITY' | 'OUTSTATION';

const SEGMENTS = [
  { value: 'INCITY' as const, label: 'InCity' },
  { value: 'OUTSTATION' as const, label: 'Outstation' },
];

export function PackagesScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('INCITY');

  const incity = useIncityPackages();
  const outstation = useOutstationPackages();

  // Both lists load at once rather than per tab. They are tens of rows between them, the tab is
  // a toggle people flick back and forth, and a spinner on every flick is worse than one request
  // the screen may not use.
  const query = tab === 'INCITY' ? incity : outstation;

  return (
    <div className="flex flex-col gap-4 pb-16">
      <TopProgressBar active={incity.isFetching || outstation.isFetching} />

      <PageHeader
        title="Packages"
        breadcrumbs={[{ label: 'Packages' }]}
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl value={tab} onValueChange={setTab} segments={SEGMENTS} label="Product" />
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                router.push(tab === 'INCITY' ? '/packages/incity/new' : '/packages/outstation/new')
              }
            >
              {tab === 'INCITY' ? 'New package' : 'New band'}
            </Button>
          </div>
        }
      />

      <p className="text-xs text-text-subtle max-w-3xl">
        Zones decide whether we serve a trip; packages decide what the product is and what it
        costs. The customer never chooses between these two — the server picks one from the pickup
        and drop points. Amounts are in{' '}
        <strong className="font-medium text-text">rupees</strong>.
      </p>

      <section className="bg-surface border border-border rounded-md p-4">
        <DataState
          loading={query.isLoading}
          error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
          skeleton={<SkeletonTable rows={4} columns={INCITY_COLUMN_WIDTHS} />}
        >
          {tab === 'INCITY' ? (
            incity.data === undefined || incity.data.packages.length === 0 ? (
              /* Worded as an alert, not a neutral empty state. A serviceable city with nothing
                 to sell is a configuration gap, not a customer problem — the same way the zones
                 screen's city card renders zero packages as a warning rather than an empty list. */
              <EmptyState
                icon={<PackageIcon className="size-6" />}
                title="Nothing to sell in the city"
                description="No incity package exists, so every hourly quote returns NO_PACKAGE_AVAILABLE and we turn the booking away. This is a config gap, not a customer problem."
                action={
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => router.push('/packages/incity/new')}
                  >
                    Create a package
                  </Button>
                }
              />
            ) : (
              <IncityTable packages={incity.data.packages} refetching={incity.isFetching} />
            )
          ) : (
            <OutstationView
              packages={outstation.data?.packages ?? []}
              refetching={outstation.isFetching}
            />
          )}
        </DataState>
      </section>

      {/*
        BELOW BOTH TABS, not inside either. The question it answers — which product a trip
        resolves to — spans the two, and it is the screen somebody reaches for when a package is
        configured and a trip still prices wrong.
      */}
      <TripResolutionPanel />
    </div>
  );
}
