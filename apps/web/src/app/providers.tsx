'use client';

import { useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster, TooltipProvider } from '@driverzone/design-system';
import { SessionProvider } from '@/lib/auth/SessionProvider';
import { makeQueryClient } from '@/lib/query/client';

export function Providers({ children }: { children: ReactNode }) {
  // useState, not a module-level client. A module-level QueryClient is shared across every
  // request in the same Node process, which in dev means one admin's cache surviving a
  // fast-refresh and in a server context would mean sharing it between users.
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <TooltipProvider>
          {children}
          {/* Outside the panel gate on purpose: a mutation's failure toast must still render
              if the same failure signed the admin out from under it. */}
          <Toaster />
        </TooltipProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
