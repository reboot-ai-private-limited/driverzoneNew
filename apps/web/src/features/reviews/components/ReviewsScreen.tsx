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
  Select,
  SkeletonTable,
  TopProgressBar,
} from '@driverzone/design-system';
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue';
import { Star } from 'lucide-react';
import { toErrorState } from '@/lib/api/toErrorState';
import { useReviews } from '../hooks/useReviews';
import { ReviewsTable } from './ReviewsTable';

/**
 * REVIEWS — the ops moderation queue for post-trip ratings.
 *
 * Its job is not to display every review; it is to FIND THE BAD ONES. That is why the rating and
 * flagged filters go to the server rather than being applied to a fetched page: `listForAdmin` is
 * capped at 200 rows, so a browser-side filter silently stops finding old one-star reviews the
 * moment the table outgrows the cap — and the oldest unactioned complaint is exactly the one that
 * matters most.
 *
 * Free-text search stays client-side, because there is no server field for it. It matches the
 * REVIEWEE — the person being rated, who is the driver on the Drivers tab and the customer on the
 * Customers tab, so the same box does the obvious thing on both.
 */

type Tab = 'DRIVERS' | 'CUSTOMERS';

const SEGMENTS = [
  { value: 'DRIVERS' as const, label: 'Drivers' },
  { value: 'CUSTOMERS' as const, label: 'Customers' },
];

/**
 * `2` first, and it is the default view for a reason: two stars and below is the threshold the
 * API auto-flags on, so "Needs attention" and the flag mean the same thing rather than two
 * competing ideas of what a bad review is.
 */
const RATING_OPTIONS = [
  { value: 'all', label: 'Any rating' },
  { value: '2', label: '2 stars and below' },
  { value: '3', label: '3 stars and below' },
  { value: '1', label: '1 star only' },
];

const FLAG_OPTIONS = [
  { value: 'all', label: 'All reviews' },
  { value: 'flagged', label: 'Flagged only' },
];

export function ReviewsScreen() {
  const [tab, setTab] = useState<Tab>('DRIVERS');
  const [typed, setTyped] = useState('');
  const [rating, setRating] = useState('all');
  const [flag, setFlag] = useState('all');
  const search = useDebouncedValue(typed, 250);

  const query = useReviews({
    revieweeRole: tab === 'DRIVERS' ? 'DRIVER' : 'CUSTOMER',
    ratingLte: rating === 'all' ? undefined : Number(rating),
    flaggedOnly: flag === 'flagged',
  });

  /*
   * Name only. The previous placeholder offered "name or phone" and no phone number is in
   * `AdminReviewDto` at all, so typing one matched nothing and read as a broken search rather
   * than an unsupported one.
   */
  const rows = query.data?.filter((review) => {
    if (search === '') return true;
    return review.reviewee.name.toLowerCase().includes(search.toLowerCase());
  });

  const filtered = rating !== 'all' || flag !== 'all' || search !== '';

  return (
    <div className="flex flex-col gap-4 pb-16">
      <TopProgressBar active={query.isFetching} />

      <PageHeader
        title="Reviews"
        breadcrumbs={[{ label: 'Reviews' }]}
        actions={
          <SegmentedControl value={tab} onValueChange={setTab} segments={SEGMENTS} label="Target" />
        }
      />

      <p className="text-xs text-text-subtle max-w-3xl">
        A ledger of all post-trip ratings. <strong>Driver</strong> reviews are submitted by
        customers; <strong>Customer</strong> reviews are submitted by drivers. Ratings of two stars
        and below are flagged automatically — flagging hides a review from public averages without
        deleting it.
      </p>

      <FilterBar>
        <FilterField label="Search" className="flex-1 min-w-64">
          <SearchInput
            value={typed}
            onChange={setTyped}
            placeholder={tab === 'DRIVERS' ? 'Search by driver name' : 'Search by customer name'}
          />
        </FilterField>

        <FilterField label="Rating">
          <Select value={rating} onValueChange={setRating} options={RATING_OPTIONS} />
        </FilterField>

        <FilterField label="Status">
          <Select value={flag} onValueChange={setFlag} options={FLAG_OPTIONS} />
        </FilterField>
      </FilterBar>

      <section className="bg-surface border border-border rounded-md p-4">
        <DataState
          loading={query.isLoading}
          error={query.isError ? toErrorState(query.error, () => void query.refetch()) : undefined}
          skeleton={<SkeletonTable rows={5} columns={['1fr', '1fr', '1fr', '1fr', '1fr']} />}
        >
          {rows === undefined || rows.length === 0 ? (
            <EmptyState
              icon={<Star className="size-6" />}
              title={filtered ? 'No reviews match these filters' : `No ${tab.toLowerCase()} reviews yet`}
              description={
                filtered
                  ? 'Try widening the rating or clearing the search.'
                  : 'No ratings have been published for this group.'
              }
            />
          ) : (
            <ReviewsTable reviews={rows} refetching={query.isFetching} />
          )}
        </DataState>
      </section>
    </div>
  );
}
