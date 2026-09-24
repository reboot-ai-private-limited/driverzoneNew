import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter_Tight } from 'next/font/google';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteHeader } from '@/components/SiteHeader';
import { FloatingActions } from '@/components/FloatingActions';
import { SITE_URL } from '@/lib/site';
import './globals.css';

const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-inter-tight',
  display: 'swap',
});

/**
 * THE OPPOSITE OF `apps/web`'s ROOT LAYOUT IN ONE RESPECT, and it is the important one.
 *
 * The admin panel sets `robots: { index: false, follow: false }` with the comment "An internal
 * tool. Nothing here should ever appear in a search result." This site exists to appear in search
 * results — so it says so explicitly rather than relying on the absence of a rule, and carries
 * the Open Graph data that decides what a shared link looks like in WhatsApp, which is where a
 * link to a service like this actually travels in India.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#f2f200',
};

export const metadata: Metadata = {
  /*
   * `metadataBase` is what lets the relative OG image below resolve to an absolute URL. Without
   * it Next emits a relative `og:image`, which every scraper ignores — the preview silently falls
   * back to a bare link with no card, and nothing in the build warns you.
   */
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Hire Verified Drivers for Your Car in Siliguri | DriverZone',
    /*
     * `%s` is filled by each page's own `title`. Keeping the brand in the template means no page
     * has to remember to append it, and a shared link always carries the name of the service.
     */
    template: '%s — DriverZone',
  },
  description:
    'Book a professional driver for your own car. Hourly packages in the city, day rates for outstation and hill journeys. Available in Siliguri and across North Bengal.',
  applicationName: 'DriverZone',
  icons: { icon: '/logo.svg' },
  openGraph: {
    type: 'website',
    siteName: 'DriverZone',
    title: 'DriverZone — professional drivers for your own car',
    description:
      'Hourly packages in the city, day rates for outstation and hill journeys. Your car, our driver.',
    url: SITE_URL,
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={interTight.variable}>
      <body className="flex min-h-screen flex-col">
        {/*
          A skip link, first in the DOM and visible only once focused. Every page here is a long
          scroll behind the same header, so a keyboard or screen-reader user would otherwise tab
          through the whole navigation on each one before reaching the content.
        */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-fg focus:px-4 focus:py-2 focus:text-on-fg"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <FloatingActions />
      </body>
    </html>
  );
}
