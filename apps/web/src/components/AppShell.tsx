'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@driverzone/design-system';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

const PIN_KEY = 'dz.nav.pinned';

/**
 * Rail + top bar + content.
 *
 * The content region's left offset is `--spacing-rail` and stays there while the nav is
 * hovered, because the nav overlays rather than pushing. Pinning is the one case where the
 * offset changes, and that is a deliberate, persistent choice rather than something that
 * happens as the cursor crosses the page.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // Starts false and is corrected after mount. Reading localStorage during render would
  // produce different markup on the server and the client, which React rejects as a hydration
  // mismatch — the preference is not worth a flash of the wrong layout either way.
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    setPinned(window.localStorage.getItem(PIN_KEY) === 'true');
  }, []);

  const togglePin = (): void => {
    setPinned((current) => {
      window.localStorage.setItem(PIN_KEY, String(!current));
      return !current;
    });
  };

  return (
    <div className="min-h-screen bg-surface-sunken">
      <SideNav pinned={pinned} />
      <div
        className={cn(
          'flex flex-col min-h-screen transition-[padding] duration-200 ease-out',
          pinned ? 'pl-nav-open' : 'pl-rail',
        )}
      >
        <TopBar pinned={pinned} onTogglePin={togglePin} />
        {/*
          Capped at --spacing-content-max. A table stretched across 3440px puts a row's first
          and last cell too far apart to read as one row; the rail sits outside this, so the
          layout stays anchored left rather than floating in the middle of an ultrawide.
        */}
        <main className="flex-1 w-full max-w-content-max p-6 flex flex-col gap-4">{children}</main>
      </div>
    </div>
  );
}
