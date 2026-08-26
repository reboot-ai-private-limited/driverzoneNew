'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Tooltip, cn } from '@driverzone/design-system';
import { useSession } from '@/lib/auth/SessionProvider';
import { NAV_ITEMS } from './nav-items';

/**
 * When the nav is expanded. Three triggers, and they must stay in lockstep with the label
 * reveal below — a width that grows while the labels stay hidden is a rail full of dead space.
 *
 * The media query is not decoration: on a touch device there is no hover state to LEAVE, so
 * without it the panel opens over the content on first tap and stays there. The pin toggle is
 * the only way in on touch.
 *
 * `hover:` and `focus-within:`, NOT `group-hover:`/`group-focus-within:`. The group variants
 * compile to a descendant selector — `:is(:where(.group):hover *)` — and this class sits on the
 * group element itself, which is not a descendant of itself. It would silently never match and
 * the nav would stay stuck at 64px. The labels below are descendants, so they DO use the group
 * variants; the two are not interchangeable.
 */
const EXPANDED_WIDTH = '[@media(hover:hover)]:hover:w-nav-open focus-within:w-nav-open';

/**
 * Labels are hidden by OPACITY, never `hidden` or conditional rendering.
 *
 * They stay in the accessibility tree at every width, so an admin using a screen reader hears
 * "Zones", not "link". Layout width does not matter — the nav clips with `overflow-hidden`.
 */
const LABEL =
  'opacity-0 transition-opacity duration-150 [@media(hover:hover)]:group-hover:opacity-100 group-focus-within:opacity-100';

export interface SideNavProps {
  /** Persistent-expanded. Unlike hover, this DOES push the content region. */
  pinned: boolean;
}

/**
 * A 64px icon rail that expands to 240px as an OVERLAY.
 *
 * The content region keeps its 64px offset and never reflows — that is the entire point.
 * Hovering the nav is free: no layout, no scroll jump, no table shifting under the cursor.
 */
export function SideNav({ pinned }: SideNavProps) {
  const pathname = usePathname();
  const { admin, signOut } = useSession();

  /*
   * TERNARIES, not `cn(base, pinned && override)`.
   *
   * `cn` is tailwind-merge, and tailwind-merge does not know this project's custom theme keys:
   * it dedupes `w-4`/`w-8` but passes `w-rail w-nav-open` through untouched. Both classes then
   * land on the element with equal specificity, so the stylesheet's source order decides — and
   * Tailwind emits `.w-rail` after `.w-nav-open`, so the rail always won and the pin toggle did
   * nothing at all. Hover and focus were unaffected only because their pseudo-classes carry
   * extra specificity.
   *
   * Emitting exactly one class per slot sidesteps the question entirely.
   */
  const label = pinned ? 'opacity-100' : LABEL;

  return (
    <nav
      aria-label="Main"
      className={cn(
        'group fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden',
        'bg-surface border-r border-border',
        'transition-[width] duration-200 ease-out',
        pinned ? 'w-nav-open' : 'w-rail',
        // Harmless while pinned — the width is already open — so it does not need excluding.
        EXPANDED_WIDTH,
      )}
    >
      <div className="flex items-center h-14 px-3 shrink-0">
        {/*
          The brand asset is a 236x126 horizontal lockup with no square mark, so the rail shows
          a placeholder tile — see docs/engineering/design-language.md §Brand assets.
        */}
        <span className="size-10 shrink-0 rounded-md bg-accent grid place-items-center text-accent-ink font-bold">
          DZ
        </span>
        <span className={cn('ml-2 text-sm font-semibold text-text whitespace-nowrap', label)}>
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
                'flex items-center h-10 rounded-md gap-3 whitespace-nowrap relative',
                // 14px, so the 20px icon sits centred in the 48px the rail leaves after the
                // list's own padding. The rail has to read as a column of icons, not as a
                // left-aligned row that happens to be cut off.
                'pl-3.5 pr-2.5',
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
              <span className={cn('text-sm', label)}>{item.label}</span>
            </span>
          );

          if (item.comingSoon === true) {
            // The only nav tooltip worth having. A tooltip repeating a label would be pure
            // noise: you cannot hover an item without hovering the nav, so by the time one
            // could appear the label beside it is already visible.
            return (
              <li key={item.href}>
                <Tooltip content={`${item.label} — not built yet`}>
                  <span aria-disabled className="block">
                    {content}
                  </span>
                </Tooltip>
              </li>
            );
          }

          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? 'page' : undefined} className="block">
                {content}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="shrink-0 border-t border-border p-2">
        <div className="flex items-center gap-3 h-10 pl-3.5 pr-2.5 whitespace-nowrap">
          <span className="size-5 shrink-0 rounded-pill bg-surface-muted grid place-items-center text-[10px] text-text-subtle">
            {admin?.full_name.charAt(0).toUpperCase() ?? '?'}
          </span>
          <span className={cn('flex flex-col leading-tight min-w-0', label)}>
            <span className="text-xs text-text truncate">{admin?.full_name ?? '—'}</span>
            <span className="text-xs text-text-subtle">Admin</span>
          </span>
        </div>

        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center h-10 w-full rounded-md pl-3.5 pr-2.5 gap-3 text-text-subtle hover:bg-surface-muted hover:text-text whitespace-nowrap"
        >
          <LogOut aria-hidden className="size-5 shrink-0" />
          <span className={cn('text-sm', label)}>Sign out</span>
        </button>
      </div>
    </nav>
  );
}
