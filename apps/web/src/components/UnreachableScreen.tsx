'use client';

import { ErrorState } from '@driverzone/design-system';
import { useSession } from '@/lib/auth/SessionProvider';

/**
 * "The API did not answer", shown by both session gates.
 *
 * Shared rather than copied because the two gates must agree. `restore()` throws only on a
 * network fault — a 401 resolves to `false` — so this state means the server is down, and an
 * admin who sees it on /zones and something different on /login learns nothing from either.
 *
 * The login gate needs it as much as the panel does: a login form rendered against an
 * unreachable API is a form whose every submit fails for a reason it cannot explain.
 */
export function UnreachableScreen() {
  const { retryBoot } = useSession();

  return (
    <div className="min-h-screen grid place-items-center bg-surface-sunken p-4">
      <ErrorState
        title="Cannot reach the server"
        message="The API did not respond. It may still be starting up."
        onRetry={retryBoot}
      />
    </div>
  );
}
