'use client';

import { useEffect } from 'react';
import { ErrorState } from '@driverzone/design-system';

/**
 * The last line of defence — a render-time throw, not a failed request. A failed request is
 * handled by `<DataState>` where the data would have been, which keeps the chrome intact.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen grid place-items-center bg-surface-sunken p-4">
      <ErrorState
        title="Something went wrong"
        message="This screen failed to render. The error has been logged to the browser console."
        {...(error.digest === undefined ? {} : { requestId: error.digest })}
        onRetry={reset}
      />
    </div>
  );
}
