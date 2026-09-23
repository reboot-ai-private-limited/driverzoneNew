import Image from 'next/image';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { CONTACT } from '@/lib/site';

/**
 * The footer, and the place the three Play Store obligations surface as public URLs.
 *
 * `/privacy`, `/terms` and `/delete-account` are not decoration here. Google Play requires a
 * privacy policy at a public URL, and requires any app offering account creation to offer account
 * deletion from a page reachable WITHOUT installing the app. Linking them from every page is the
 * cheapest way to keep all three live and findable — by a customer, and by a reviewer who will
 * look for them. See `docs/` and the store checklist.
 */
export function SiteFooter(): ReactElement {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-bg-sunken">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          <div className="md:col-span-2">
            <Image src="/logo.svg" alt="DriverZone" width={118} height={63} className="h-8 w-auto" />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
              Professional drivers for your own car — by the hour in the city, or by the day for
              outstation journeys.
            </p>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-fg">Company</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <FooterLink href="/about">About us</FooterLink>
              <FooterLink href="/contact">Contact</FooterLink>
              <FooterLink href="/#services">Services</FooterLink>
              <FooterLink href="/#how-it-works">How it works</FooterLink>
            </ul>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-fg">Legal</h2>
            <ul className="mt-4 space-y-3 text-sm">
              <FooterLink href="/privacy">Privacy Policy</FooterLink>
              <FooterLink href="/terms">Terms &amp; Conditions</FooterLink>
              <FooterLink href="/delete-account">Delete your account</FooterLink>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} DriverZone. All rights reserved.</p>
          <p>
            <a href={`mailto:${CONTACT.email}`} className="transition-colors hover:text-fg">
              {CONTACT.email}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: string }): ReactElement {
  return (
    <li>
      <Link href={href} className="text-muted transition-colors hover:text-fg">
        {children}
      </Link>
    </li>
  );
}
