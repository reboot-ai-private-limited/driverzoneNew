import { Suspense } from 'react';
import { SkeletonTable } from '@driverzone/design-system';
import { BookingsScreen } from '@/features/bookings/components/BookingsScreen';

/**
 * The boundary is not optional. `BookingsScreen` reads its filters from the URL via
 * `useSearchParams`, and Next opts any route that does so out of static prerendering unless the
 * component sits inside a Suspense boundary — without one the build fails on this page.
 */
export default function BookingsPage() {
  return (
    <Suspense
      fallback={
        <SkeletonTable
          rows={10}
          columns={[
            'w-12',
            'w-32',
            'w-28',
            'w-36',
            'w-32',
            'w-36',
            'w-32',
            'w-64',
            'w-64',
            'w-28',
            'w-32',
            'w-24',
            'w-16',
          ]}
        />
      }
    >
      <BookingsScreen />
    </Suspense>
  );
}
