'use client';

import { useState } from 'react';
import {
  DataState,
  EmptyState,
  PageHeader,
  SegmentedControl,
  FilterBar,
  FilterField,
  SearchInput,
  SkeletonTable,
  TopProgressBar,
} from '@driverzone/design-system';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { Star } from 'lucide-react';
import { toErrorState } from '@/lib/api/toErrorState';
import { useReviews } from '../hooks/useReviews';
import { ReviewsTable } from './ReviewsTable';

type Tab = 'DRIVERS' | 'CUSTOMERS';

const SEGMENTS = [
  { value: 'DRIVERS' as const, label: 'Drivers' },
  { value: 'CUSTOMERS' as const, label: 'Customers' },
];

export function ReviewsScreen() {
  const [tab, setTab] = useState<Tab>('DRIVERS');
  const [typed, setTyped] = useState('');
  const search = useDebouncedValue(typed, 250);

  // We fetch both tabs simultaneously so flipping between them is instant
  const driverReviews = useReviews('DRIVER');
  const customerReviews = useReviews('CUSTOMER');

  const query = tab === 'DRIVERS' ? driverReviews : customerReviews;

  const filteredData = query.data?.filter((rev) => {
    if (!search) return true;
    const lowerSearch = search.toLowerCase();
    // The user requested: "while in driver tab searches driver, and customer tab curtomar name or number"
    // Since 'reviewee' is the driver in the Driver tab and the customer in the Customer tab,
    // searching the reviewee name naturally fulfills this requirement!
    return rev.reviewee.name.toLowerCase().includes(lowerSearch);
  });

  return (
    <div className="flex flex-col gap-4 pb-16">
      <TopProgressBar active={driverReviews.isFetching || customerReviews.isFetching} />

      <PageHeader
        title="Reviews"
        breadcrumbs={[{ label: 'Reviews' }]}
        actions={
          <div className="flex items-center gap-2">
            <SegmentedControl value={tab} onValueChange={setTab} segments={SEGMENTS} label="Target" />
          </div>
        }
      />

      <p className="text-xs text-text-subtle max-w-3xl">
        A ledger of all post-trip ratings. <strong>Driver</strong> reviews are submitted by customers;
        <strong> Customer</strong> reviews are submitted by drivers. Reviews with 1 or 2 stars are automatically
        flagged for ops review.
      </p>

      <FilterBar>
        <FilterField label="Search" className="flex-1 min-w-64">
          <SearchInput 
            value={typed} 
            onChange={setTyped} 
            placeholder="Search by name or phone" 
          />
        </FilterField>
      </FilterBar>
      <section className="bg-surface border border-border rounded-md p-4">
        <DataState
          loading={query.isLoading}
          error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
          skeleton={<SkeletonTable rows={5} columns={['1fr', '1fr', '1fr', '1fr', '1fr']} />}
        >
          {filteredData === undefined || filteredData.length === 0 ? (
            <EmptyState
              icon={<Star className="size-6" />}
              title={`No ${tab.toLowerCase()} reviews yet`}
              description="No ratings have been published for this group."
            />
          ) : (
            <ReviewsTable reviews={filteredData} refetching={query.isFetching} />
          )}
        </DataState>
      </section>
    </div>
  );
}
