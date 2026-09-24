import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { Suspense } from 'react';
import Link from 'next/link';
import { MessageCircle, PhoneCall } from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { PackagesGrid } from '@/components/packages/PackagesGrid';
import { FaqAccordion } from '@/components/FaqAccordion';
import { SITE_URL } from '@/lib/site';
import { ALL_PACKAGES } from '@/lib/packages-data';

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: 'Driver Hire Packages & Pricing in Siliguri | DriverZone',
  description:
    'Explore all DriverZone driver hire packages for Siliguri — In-City (one-way & round trip), Outstation, Darjeeling & Gangtok hill trips, airport transfers, and corporate plans. Transparent pricing starting ₹399.',
  alternates: {
    canonical: `${SITE_URL}/packages`,
  },
  keywords: [
    'driver hire Siliguri',
    'car driver hire Siliguri',
    'driver for hire packages',
    'outstation driver Siliguri',
    'Darjeeling day trip driver',
    'Gangtok driver hire',
    'airport transfer Bagdogra',
    'driver hire price Siliguri',
    'hire driver North Bengal',
  ],
  openGraph: {
    title: 'Driver Hire Packages & Pricing — DriverZone Siliguri',
    description:
      'All driver hire packages for Siliguri and North Bengal. In-City, Outstation, Hill Stations & Special packages. Prices from ₹399.',
    url: `${SITE_URL}/packages`,
    siteName: 'DriverZone',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/packages/in-city-one-way.webp`,
        width: 1200,
        height: 630,
        alt: 'DriverZone driver hire packages — in-city, outstation & hill station trips in Siliguri',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Driver Hire Packages & Pricing — DriverZone Siliguri',
    description:
      'In-City, Outstation, Darjeeling, Gangtok & more — all driver hire packages from ₹399.',
    images: [`${SITE_URL}/packages/in-city-one-way.webp`],
  },
};

/* ── FAQ data ────────────────────────────────────────────────────────────── */

const FAQS = [
  {
    q: 'What driver hire packages does DriverZone offer in Siliguri?',
    a: 'DriverZone offers four categories of driver hire packages in Siliguri: In-City packages (one-way and round trip, 3–8 hours), Outstation packages (up to 300 km), Hill Station day trips to Darjeeling, Gangtok, Kalimpong and Mirik, and Special packages including Bagdogra airport transfers, wedding events, and corporate monthly plans.',
  },
  {
    q: 'How much does driver hire cost in Siliguri?',
    a: 'Driver hire in Siliguri starts at ₹399 for a 3-hour In-City package. Outstation packages start at ₹799, Hill Station day trips start at ₹999, and Special packages start at ₹599 for airport transfers. All prices are transparent with no hidden charges.',
  },
  {
    q: 'Is overtime charged if the trip takes longer than the booked duration?',
    a: 'Yes. Overtime is charged at ₹99 per hour for In-City and Outstation packages, and ₹150 per hour for Hill Station and Special packages. The overtime rate is communicated upfront at the time of booking.',
  },
  {
    q: 'Can I book a driver for a Darjeeling trip from Siliguri?',
    a: 'Yes. DriverZone offers a dedicated Darjeeling Day Trip package starting at ₹1,499. All hill-route drivers are experienced with mountain roads and are background-verified. The trip covers the full Siliguri–Darjeeling–Siliguri route.',
  },
  {
    q: 'Is there a driver available for Bagdogra Airport transfers?',
    a: 'Yes. DriverZone provides a fixed-fare Airport Transfer package from ₹599 for one-way Siliguri to Bagdogra Airport (or reverse). The fare does not have surge pricing and flight-tracking is available on request.',
  },
  {
    q: 'Are the drivers background-verified?',
    a: 'All DriverZone drivers are background-checked, ID-verified, and undergo a review process before being listed on the platform. You can view driver profiles and ratings in the DriverZone mobile app before confirming a booking.',
  },
  {
    q: 'How do I book a driver hire package?',
    a: 'You can book via the DriverZone mobile app (available on Android), through our WhatsApp number +91 8509299342, or by calling (0353) 3568917. You can also fill in the request form on our Contact page and a team member will get back to you.',
  },
] as const;

/* ── JSON-LD helpers ─────────────────────────────────────────────────────── */

const itemListSchema = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'DriverZone Driver Hire Packages in Siliguri',
  description:
    'All driver hire packages offered by DriverZone in Siliguri and North Bengal.',
  url: `${SITE_URL}/packages`,
  numberOfItems: ALL_PACKAGES.length,
  itemListElement: ALL_PACKAGES.map((pkg, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: pkg.title,
    description: `${pkg.title} — ${pkg.price}/- for ${pkg.duration}. ${pkg.features[0]}.`,
    url: `${SITE_URL}/packages#${pkg.id}`,
  })),
};

const faqSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map((faq) => ({
    '@type': 'Question',
    name: faq.q,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.a,
    },
  })),
};

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'Packages & Pricing', item: `${SITE_URL}/packages` },
  ],
};

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function PackagesPage(): ReactElement {
  return (
    <>
      {/* JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      {/* Page hero */}
      <PageHero
        eyebrow="Packages & Pricing"
        title="Find the Right Package"
        lead="Transparent, flexible driver hire packages for every need — city rides, outstation journeys, Darjeeling & Gangtok hill trips, airport transfers, and corporate plans. No hidden charges. Verified drivers. Starting ₹399."
        breadcrumbs={[{ label: 'Packages & Pricing' }]}
      />

      {/* Package grid with filters + pagination */}
      <Suspense fallback={<div className="py-24 text-center text-muted">Loading packages…</div>}>
        <PackagesGrid />
      </Suspense>

      {/* ── CTA banner ──────────────────────────────────────────────────── */}
      <section className="bg-brand">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <div className="flex flex-col items-center gap-6 text-center md:flex-row md:justify-between md:text-left">
            <div>
              <h2 className="text-2xl font-bold text-fg sm:text-3xl">
                Not sure which package suits you?
              </h2>
              <p className="mt-2 text-[15px] text-fg/80">
                Our team is available on call and WhatsApp to help you choose the right package
                for your trip — free of charge.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap justify-center gap-3">
              <Link
                href="https://wa.me/918509299342?text=Hi%20DriverZone!%20I%20need%20help%20choosing%20a%20package."
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-pill bg-fg px-6 py-3 text-sm font-semibold text-on-fg transition-opacity hover:opacity-90"
              >
                <MessageCircle size={16} aria-hidden />
                WhatsApp Us
              </Link>
              <Link
                href="tel:+918509299342"
                className="flex items-center gap-2 rounded-pill border-2 border-fg px-6 py-3 text-sm font-semibold text-fg transition-colors hover:bg-fg hover:text-on-fg"
              >
                <PhoneCall size={16} aria-hidden />
                Call Now
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ section ─────────────────────────────────────────────────── */}
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <div className="text-center">
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">
              Frequently Asked
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Package FAQs
            </h2>
            <p className="mt-3 text-[15px] text-muted">
              Everything you need to know about DriverZone packages, pricing, and how to book.
            </p>
          </div>

          <div className="mt-10">
            <FaqAccordion items={FAQS} />
          </div>
        </div>
      </section>
    </>
  );
}

