'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Tooltip, cn } from '@driverzone/design-system';
import { useSession } from '@/lib/auth/SessionProvider';
import { NAV_ITEMS } from './nav-items';

export interface SideNavProps {
  /** Persistent-expanded. Unlike hover, this DOES push the content region. */
  pinned: boolean;
}

/**
 * A 64px icon rail that expands to 240px as an OVERLAY.
 *
 * The content region keeps its 64px offset and never reflows — that is the entire point.
 * `position: fixed` plus a width change on the panel itself, with the rail's width unchanged,
 * is what makes hovering the nav free: no layout, no scroll jump, no table shifting under the
 * cursor.
 *
 * Animate `transform`, not `width`. Animating width relayouts the whole document on every
 * frame, which on a 128-row table is visible as a stutter.
 */
export function SideNav({ pinned }: SideNavProps) {
  const pathname = usePathname();
  const { admin, signOut } = useSession();

  return (
    <nav
      aria-label="Main"
      className={cn(
        'group fixed inset-y-0 left-0 z-40 flex flex-col',
        'bg-surface border-r border-border',
        'w-rail transition-[width] duration-200 ease-out',
        // Hover expansion is gated behind a real pointer. On a touch device there is no
        // hover to LEAVE, so the panel would open over the content and stay there; the pin
        // toggle in the TopBar is the only way in.
        'hover:[@media(hover:hover)]:w-nav-open',
        // Keyboard parity, and not optional. Hover-only expansion means an admin tabbing into
        // the nav is navigating a column of unlabelled icons.
        'focus-within:w-nav-open',
        pinned && 'w-nav-open',
      )}
    >
      <div className="flex items-center h-14 px-3 shrink-0 overflow-hidden">
        {/*
          The brand asset is a 236x126 horizontal lockup with no square mark, so the rail
          crops it to its icon. This is a placeholder — see docs/engineering/design-language.md
          §Brand assets.
        */}
        <span className="size-10 shrink-0 rounded-md bg-accent grid place-items-center text-accent-ink font-bold">
          DZ
        </span>
        <span className="ml-2 text-sm font-semibold text-text whitespace-nowrap opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          DriverZone
        </span>
      </div>

      <ul className="flex-1 flex flex-col gap-0.5 px-2 py-2 overflow-y-auto overflow-x-hidden">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          const content = (
            <span
              className={cn(
                'flex items-center h-10 rounded-md px-2.5 gap-3 whitespace-nowrap relative',
                item.comingSoon === true
                  ? 'text-text-subtle opacity-50 cursor-default'
                  : 'text-text hover:bg-surface-muted',
                // The accent FILL with dark ink, plus a left bar so the active item still
                // reads at 64px where the label is not visible.
                active && 'bg-accent text-accent-ink hover:bg-accent',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-pill bg-accent-ink"
                />
              )}
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="text-sm">{item.label}</span>
            </span>
          );

          return (
            <li key={item.href}>
              {/*
                The tooltip labels the item while collapsed, but it is never the ONLY label:
                the text above stays in the accessibility tree at every width, because a
                tooltip is unreachable by touch and by a screen reader in browse mode.
              */}
              <Tooltip
                content={item.comingSoon === true ? `${item.label} — not built yet` : item.label}
              >
                {item.comingSoon === true ? (
                  <span aria-disabled className="block">
                    {content}
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className="block"
                  >
                    {content}
                  </Link>
                )}
              </Tooltip>
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 border-t border-border p-2">
        <div className="flex items-center gap-3 h-10 px-2.5 whitespace-nowrap overflow-hidden">
          <span className="size-6 shrink-0 rounded-pill bg-surface-muted grid place-items-center text-xs text-text-subtle">
            {admin?.full_name.charAt(0).toUpperCase() ?? '?'}
          </span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-xs text-text truncate">{admin?.full_name ?? '—'}</span>
            <span className="text-xs text-text-subtle">Admin</span>
          </span>
        </div>
        <Tooltip content="Sign out">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex items-center h-10 w-full rounded-md px-2.5 gap-3 text-text-subtle hover:bg-surface-muted hover:text-text whitespace-nowrap"
          >
            <LogOut aria-hidden className="size-5 shrink-0" />
            <span className="text-sm">Sign out</span>
          </button>
        </Tooltip>
      </div>
    </nav>
  );
}
