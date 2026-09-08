import { Suspense } from 'react';
import { SkeletonTable } from '@driverzone/design-system';
import { FinanceScreen } from '@/features/finance/components/FinanceScreen';

/**
 * The boundary is not optional. `DriverBalancesTab` reads its filters from the URL via
 * `useSearchParams`, and Next opts any route that does so out of static prerendering unless the
 * component sits inside a Suspense boundary — without one the build fails on this page.
 */
export default function FinancePage() {
  return (
    <Suspense
      fallback={<SkeletonTable rows={8} columns={['w-56', 'w-36', 'w-36', 'w-36', 'w-32', 'w-28']} />}
    >
      <FinanceScreen />
    </Suspense>
  );
}
