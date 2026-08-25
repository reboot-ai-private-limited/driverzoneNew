'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ErrorState, Skeleton } from '@driverzone/design-system';
import { AppShell } from '@/components/AppShell';
import { useSession } from '@/lib/auth/SessionProvider';

/**
 * The gate. Every panel route is behind this.
 *
 * The four session states get four different treatments, and collapsing any two of them makes
 * the app lie about what is happening.
 */
export default function PanelLayout({ children }: { children: ReactNode }) {
  const { status, retryBoot } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') router.replace('/login');
  }, [status, router]);

  // Boot restore is a network round-trip, always — the access token is never persisted. This
  // is the skeleton that stops it being a flash of the login screen followed by the real page.
  if (status === 'booting' || status === 'anonymous') return <BootSkeleton />;

  if (status === 'unreachable') {
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

  return <AppShell>{children}</AppShell>;
}

/** The shell's own geometry, so the chrome does not move when the real thing renders. */
function BootSkeleton() {
  return (
    <div className="min-h-screen bg-surface-sunken">
      <div className="fixed inset-y-0 left-0 w-rail bg-surface border-r border-border p-2 flex flex-col gap-2">
        <Skeleton className="size-10 rounded-md" />
        {Array.from({ length: 8 }, (_, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <Skeleton key={i} className="h-10 rounded-md" />
        ))}
      </div>
      <div className="pl-rail">
        <div className="h-14 bg-surface border-b border-border" />
        <div className="p-6 flex flex-col gap-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-64 rounded-md" />
        </div>
      </div>
    </div>
  );
}
