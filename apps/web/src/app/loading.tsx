import { Skeleton } from '@driverzone/design-system';

/**
 * Route-level loading. This is the ROUTE CHUNK loading, not data — the panel fetches on the
 * client. It renders the content area's shape only; the chrome is not what is loading, and
 * blanking it on every navigation is the full-page spinner this design rules out.
 */
export default function Loading() {
  return (
    <div className="p-6 flex flex-col gap-4">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="h-96 w-full rounded-md" />
    </div>
  );
}
