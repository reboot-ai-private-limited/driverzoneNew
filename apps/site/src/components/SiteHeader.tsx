'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useState, type ReactElement } from 'react';

/**
 * The site header — the only client component in the chrome, because of the mobile menu and the
 * active-route pill.
 *
 * Everything else on this site renders on the server: a brochure page has no state, and shipping
 * React to the browser to paint static copy is the thing a marketing site is most often and most
 * needlessly slow for. The interactive elements are this menu and `usePathname`, so this is the
 * one file carrying `'use client'`.
 *
 * The bar itself is transparent — only the pills are frosted (`.glass` in `globals.css`), so the
 * page shows through between them as the header floats over it.
 */

/**
 * Mostly in-page anchors, not routes. The home page is one scrolling document — services and the
 * steps are sections of it rather than separate pages, because there is not enough on either to
 * justify a navigation that makes someone wait for a page load to read four lines.
 *
 * `globals.css` sets `scroll-padding-top` so these land below the sticky header rather than
 * underneath it.
 */
const NAV = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/about', label: 'About Us' },
  { href: '/contact', label: 'Contact' },
] as const;

/**
 * Only real routes can be "current" — an anchor like `/#services` shares the home page's pathname,
 * and lighting it up alongside Home would mark two pills active at once.
 */
function isActive(href: string, pathname: string): boolean {
  return !href.includes('#') && href === pathname;
}

const PILL =
  'glass inline-flex items-center rounded-pill px-5 py-2 text-sm font-medium text-fg transition-[background-color,transform] duration-200 hover:[--glass-tint:rgb(255_255_255/0.4)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg';

/* Solid brand pill: active page + CTA use the brand lime so the eye lands on them first. */
const PILL_SOLID =
  'inline-flex items-center rounded-pill bg-brand px-5 py-2 text-sm font-semibold text-fg shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)] transition-[opacity,transform] duration-200 hover:opacity-90 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg';

export function SiteHeader(): ReactElement {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-4 z-50 px-4">
      <div className="bg-white/40 backdrop-blur-sm glass backdrop-saturate-150 mx-auto flex h-14
       max-w-6xl items-center justify-between gap-4 rounded-full px-2 sm:px-3">
        <Link href="/" className="flex shrink-0 items-center" aria-label="DriverZone home">
          <Image
            src="/logo.svg"
            alt="DriverZone"
            width={118}
            height={63}
            /*
             * `priority` because this is the largest-contentful-paint candidate on every page —
             * it is the first thing above the fold and Next would otherwise lazy-load it, which
             * shows the header as a blank strip for a beat on a cold load.
             */
            priority
            className="h-10 w-auto ml-1"
          />
        </Link>

        <nav className="hidden items-center gap-2 lg:flex xl:gap-3" aria-label="Main">
          {NAV.map((item) => {
            const active = isActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={active ? PILL_SOLID : PILL}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/#get-the-app" className={`${PILL_SOLID} hidden lg:inline-flex`}>
            Get the app
          </Link>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="glass inline-flex h-11 w-11 items-center justify-center rounded-pill text-fg lg:hidden"
            /*
             * `aria-expanded` and `aria-controls` are what make this a disclosure rather than a
             * mystery button to a screen reader — without them the menu opens silently and the
             * button reads the same either way.
             */
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <nav id="mobile-menu" className="px-4 pb-4 sm:px-6 lg:hidden" aria-label="Main, mobile">
          {/*
            A stronger tint than the pills: this panel covers body copy, and at 16% the text
            underneath competes with the menu items.
          */}
          <ul className="glass mx-auto flex max-w-6xl flex-col gap-1 rounded-xl p-2 [--glass-tint:rgb(255_255_255/0.72)] [--glass-blur:16px]">
            {NAV.map((item) => {
              const active = isActive(item.href, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    /*
                     * Closing on navigate matters for the anchor links specifically: they do not
                     * change the route, so nothing else would ever dismiss the menu and the page
                     * would scroll behind a panel still covering it.
                     */
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-4 py-3 text-base font-medium transition-colors ${
                      active ? 'bg-fg text-on-fg' : 'text-fg hover:bg-fg/5'
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li className="pt-1">
              <Link
                href="/#get-the-app"
                onClick={() => setOpen(false)}
                className="inline-flex w-full items-center justify-center rounded-pill bg-brand px-5 py-3 text-sm font-semibold text-fg shadow-[0_8px_24px_-12px_rgb(0_0_0/0.35)]"
              >
                Get the app
              </Link>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
