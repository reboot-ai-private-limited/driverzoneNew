'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@driverzone/design-system';
import { UnreachableScreen } from '@/components/UnreachableScreen';
import { useSession } from '@/lib/auth/SessionProvider';
import { destinationAfterLogin } from '@/lib/auth/next-path';

/**
 * The gate on /login, and the mirror image of app/(panel)/layout.tsx.
 *
 * Without it the login form is reachable while signed in, which is not merely untidy: boot
 * restore is a network round-trip, so a signed-in admin who opens /login gets the form
 * IMMEDIATELY and keeps it, because the redirect that would rescue them lives in the panel
 * layout they never reached. They then sign in again to get where they already were.
 *
 * Hence the skeleton on `booting`. Rendering the form first and correcting once the session
 * resolves is precisely the flash this avoids — and it is the same reason the panel shows its
 * own skeleton rather than a flash of this screen.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // `window.location`, not `useSearchParams`. The hook opts the route out of static
    // prerendering unless it sits under a Suspense boundary — the reason (panel)/zones/page.tsx
    // has one — and a layout cannot be wrapped by its own page. Nothing here needs the value
    // during render; this runs on the client, after mount, where `window` exists.
    if (status === 'authenticated') router.replace(destinationAfterLogin());
  }, [status, router]);

  if (status === 'unreachable') return <UnreachableScreen />;

  // `authenticated` holds the skeleton until the redirect above lands. Falling through to the
  // form for that one frame is the flash this whole file exists to prevent.
  if (status === 'booting' || status === 'authenticated') return <LoginSkeleton />;

  return <>{children}</>;
}

/** The login card's geometry, so the form does not jump when it replaces this. */
function LoginSkeleton() {
  return (
    <div className="min-h-screen grid place-items-center bg-surface-sunken p-4">
      <div className="w-full max-w-sm flex flex-col gap-6 bg-surface border border-border rounded-md p-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="size-10 rounded-md" />
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 rounded-md" />
          <Skeleton className="h-9 rounded-md" />
        </div>
      </div>
    </div>
  );
}
