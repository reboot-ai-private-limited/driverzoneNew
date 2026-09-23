'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useState, type ReactElement } from 'react';

/**
 * The site header — the only client component in the chrome, and only because of the mobile menu.
 *
 * Everything else on this site renders on the server: a brochure page has no state, and shipping
 * React to the browser to paint static copy is the thing a marketing site is most often and most
 * needlessly slow for. The one genuinely interactive element is this menu, so it is the one file
 * carrying `'use client'`.
 */

/**
 * In-page anchors, not routes. The home page is one scrolling document — services and the steps
 * are sections of it rather than separate pages, because there is not enough on either to justify
 * a navigation that makes someone wait for a page load to read four lines.
 *
 * `globals.css` sets `scroll-padding-top` so these land below the sticky header rather than
 * underneath it.
 */
const NAV = [
  { href: '/#services', label: 'Services' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;

export function SiteHeader(): ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center" aria-label="DriverZone home">
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
            className="h-8 w-auto"
          />
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="Main">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-sm font-medium text-muted transition-colors hover:text-fg"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/#get-the-app"
            className="hidden rounded-pill bg-fg px-5 py-2.5 text-sm font-semibold text-on-fg transition-opacity hover:opacity-90 md:inline-flex"
          >
            Get the app
          </Link>

          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-fg md:hidden"
            /*
             * `aria-expanded` and `aria-controls` are what make this a disclosure rather than a
             * mystery button to a screen reader — without them the menu opens silently and the
             * button reads the same either way.
             */
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
          >
            {open ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
          </button>
        </div>
      </div>

      {open ? (
        <nav
          id="mobile-menu"
          className="border-t border-border bg-bg md:hidden"
          aria-label="Main, mobile"
        >
          <ul className="mx-auto max-w-6xl px-4 py-2 sm:px-6">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  /*
                   * Closing on navigate matters for the anchor links specifically: they do not
                   * change the route, so nothing else would ever dismiss the menu and the page
                   * would scroll behind a panel still covering it.
                   */
                  onClick={() => setOpen(false)}
                  className="block border-b border-border py-3 text-base font-medium text-fg last:border-0"
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="py-3">
              <Link
                href="/#get-the-app"
                onClick={() => setOpen(false)}
                className="inline-flex w-full items-center justify-center rounded-pill bg-fg px-5 py-3 text-sm font-semibold text-on-fg"
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
