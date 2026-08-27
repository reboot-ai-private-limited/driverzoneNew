import { Suspense } from 'react';
import { Skeleton } from '@driverzone/design-system';
import { ZonesScreen } from '@/features/zones/components/ZonesScreen';

/**
 * The boundary is not optional. `ZonesScreen` reads its view and selection from the URL via
 * `useSearchParams`, and Next opts any route that does so out of static prerendering unless the
 * component sits inside a Suspense boundary — without one the build fails on this page.
 */
export default function ZonesPage() {
  return (
    <Suspense fallback={<ZonesFallback />}>
      <ZonesScreen />
    </Suspense>
  );
}

/** The screen's real geometry — rail plus map — so the layout does not jump when it mounts. */
function ZonesFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-6 w-32" />
      <div className="flex gap-0 border border-border rounded-md overflow-hidden">
        <div className="w-80 shrink-0 border-r border-border p-4 flex flex-col gap-3">
          {Array.from({ length: 5 }, (_, index) => (
            // eslint-disable-next-line react/no-array-index-key
            <Skeleton key={index} className="h-16 rounded-md" />
          ))}
        </div>
        <Skeleton className="flex-1 h-[36rem] rounded-none" />
      </div>
    </div>
  );
}
