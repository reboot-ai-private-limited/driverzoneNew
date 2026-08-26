import { Suspense } from 'react';
import { SkeletonTable } from '@driverzone/design-system';
import { ZonesScreen } from '@/features/zones/components/ZonesScreen';

/**
 * The boundary is not optional. `ZonesScreen` reads its filters from the URL via
 * `useSearchParams`, and Next opts any route that does so out of static prerendering unless the
 * component sits inside a Suspense boundary — without one the build fails on this page.
 */
export default function ZonesPage() {
  return (
    <Suspense fallback={<SkeletonTable rows={10} columns={['w-64', 'w-24', 'w-24', 'w-24']} />}>
      <ZonesScreen />
    </Suspense>
  );
}
