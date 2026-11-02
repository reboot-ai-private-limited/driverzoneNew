import type { Metadata } from 'next';
import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import {
  Clock,
  Route,
  Mountain,
  Plane,
  Briefcase,
  Heart,
  ShieldCheck,
  BadgeCheck,
  Wallet,
  Headphones,
  MessageCircle,
  PhoneCall,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { HowItWorksSection } from '@/components/HowItWorksSection';
import { SITE_URL } from '@/lib/site';

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: 'Driver Hire Services in Siliguri — In-City, Outstation & Hill Trips',
  description:
    'DriverZone provides professional driver hire services in Siliguri — in-city hourly packages, outstation day trips, Darjeeling & Gangtok hill journeys, Bagdogra airport transfers, wedding events, and corporate monthly plans. Verified drivers. Transparent pricing.',
  alternates: {
    canonical: `${SITE_URL}/services`,
  },
  keywords: [
    'driver hire services Siliguri',
    'car driver hire Siliguri',
    'outstation driver Siliguri',
    'Darjeeling driver hire',
    'airport transfer Bagdogra',
    'corporate driver Siliguri',
    'wedding driver hire Siliguri',
    'hourly driver hire Siliguri',
    'hill station driver North Bengal',
  ],
  openGraph: {
    title: 'Driver Hire Services — DriverZone Siliguri',
    description:
      'In-city hourly packages, outstation trips, hill station journeys, airport transfers and more. Verified drivers, transparent pricing — DriverZone Siliguri.',
    url: `${SITE_URL}/services`,
    siteName: 'DriverZone',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/promo-banner.webp`,
        width: 1200,
        height: 630,
        alt: 'DriverZone professional driver hire services in Siliguri — in-city, outstation & hill trips',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Driver Hire Services — DriverZone Siliguri',
    description:
      'In-city, outstation, Darjeeling, Gangtok, airport & corporate driver hire services in Siliguri.',
    images: [`${SITE_URL}/promo-banner.webp`],
  },
};

/* ── JSON-LD ─────────────────────────────────────────────────────────────── */

const breadcrumbSchema = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
    { '@type': 'ListItem', position: 2, name: 'Services', item: `${SITE_URL}/services` },
  ],
};

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Driver Hire Services in Siliguri',
  provider: {
    '@type': 'LocalBusiness',
    name: 'DriverZone',
    url: SITE_URL,
    telephone: '+918509299342',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Kalibari, Shanti Nagar',
      addressLocality: 'Siliguri',
      addressRegion: 'West Bengal',
      postalCode: '734004',
      addressCountry: 'IN',
    },
    areaServed: ['Siliguri', 'Darjeeling', 'Gangtok', 'Kalimpong', 'Mirik', 'North Bengal'],
  },
  serviceType: 'Driver Hire',
  description:
    'Professional driver hire for in-city trips, outstation journeys, hill station routes, airport transfers, weddings, and corporate travel in Siliguri and North Bengal.',
  url: `${SITE_URL}/services`,
};

/* ── Section 1 data: Services ────────────────────────────────────────────── */

type ServiceItem = {
  icon: LucideIcon;
  title: string;
  tag: string;
  description: string;
  points: readonly string[];
  href: string;
};

const SERVICES: readonly ServiceItem[] = [
  {
    icon: Clock,
    title: 'In-City One Way',
    tag: 'Hourly · From ₹399',
    description:
      'Need a driver for a few hours within Siliguri? Pick the block of time you need — school runs, errands, medical appointments, or an evening out. The price is locked before you confirm.',
    points: [
      'Packages from 3 hrs to 8 hrs',
      'Fare shown upfront — no meter surprises',
      'Overtime available at ₹99/hour',
    ],
    href: '/packages#in-city-one-way-3h',
  },
  {
    icon: Route,
    title: 'In-City Round Trip',
    tag: 'Hourly · From ₹399',
    description:
      'Same pick-up and drop point. Great for shopping trips, hospital visits, or anywhere you need to leave your car parked and have a driver wait. Book the block, not a meter.',
    points: [
      'Pick-up & drop at the same location',
      'Packages from 3 hrs to 8 hrs',
      'Overtime available at ₹99/hour',
    ],
    href: '/packages#in-city-round-trip-3h',
  },
  {
    icon: Route,
    title: 'Outstation Trips',
    tag: 'Day Rate · From ₹799',
    description:
      'Travelling beyond Siliguri — one way or return. Day-rated packages cover up to 300 km with a clear per-day quote agreed before departure. No hidden kilometre charges.',
    points: [
      'One-way and round trips available',
      'Priced per day, confirmed before travel',
      'Driver food allowance included',
    ],
    href: '/packages#mini-outstation-one-way',
  },
  {
    icon: Mountain,
    title: 'Hill Station Journeys',
    tag: 'Full Day · From ₹999',
    description:
      'Darjeeling, Gangtok, Kalimpong, Mirik — hill routes carry their own rates and go to drivers cleared for mountain roads. Every hill-route driver is experience-verified for the route.',
    points: [
      'Routes to Darjeeling, Gangtok, Kalimpong & Mirik',
      'Hill-experienced, route-cleared drivers',
      'Full-day return trips quoted upfront',
    ],
    href: '/packages#darjeeling-day-trip',
  },
  {
    icon: Plane,
    title: 'Airport Transfer',
    tag: 'Fixed Fare · From ₹599',
    description:
      'Fixed-fare pick-up or drop to Bagdogra Airport. No surge pricing, ever. Flight-tracking available on request so your driver adjusts for delays before you land.',
    points: [
      'Fixed fare — no surge or peak pricing',
      'Bagdogra Airport pick-up & drop',
      'Flight-tracking on request',
    ],
    href: '/packages#airport-transfer-bagdogra',
  },
  {
    icon: Heart,
    title: 'Wedding & Events',
    tag: 'Full Day · From ₹2,499',
    description:
      'A professionally dressed driver for your wedding day, reception, or corporate event. Multiple pick-ups and drops, neatly coordinated for the day\'s schedule.',
    points: [
      'Professionally dressed driver',
      'Multiple stops & drop coordination',
      'Full-day availability (up to 12 hrs)',
    ],
    href: '/packages#wedding-event-package',
  },
  {
    icon: Briefcase,
    title: 'Corporate Monthly',
    tag: 'Monthly · From ₹9,999',
    description:
      'A dedicated driver assigned to your office or firm for the entire month. Monday to Saturday, 8 hours a day. Background-verified and replaceable within 24 hours if needed.',
    points: [
      'Dedicated driver for your firm',
      'Monday–Saturday, 8 hrs/day',
      'Priority support & same-day replacement',
    ],
    href: '/packages#corporate-monthly',
  },
];

/* ── Section 2 data: Why DriverZone ─────────────────────────────────────── */

type WhyItem = {
  icon: LucideIcon;
  title: string;
  body: string;
};

const WHY_ITEMS: readonly WhyItem[] = [
  {
    icon: BadgeCheck,
    title: 'Verified Drivers',
    body: 'Every driver on DriverZone is background-checked, ID-verified, and reviewed before their first booking. You see who is coming before they arrive.',
  },
  {
    icon: Wallet,
    title: 'Transparent Pricing',
    body: 'The fare is shown and locked before you confirm. No meter, no surge, no fuel surcharge added after the trip. What you see is what you pay.',
  },
  {
    icon: ShieldCheck,
    title: 'Your Car, Your Control',
    body: 'You hire the driver — not the vehicle. Travel in your own car with a professional at the wheel. Comfortable, familiar, and yours.',
  },
  {
    icon: Headphones,
    title: 'Real Support',
    body: 'Reach us on call or WhatsApp at +91 8509299342. Our team coordinates driver assignments, handles rescheduling, and resolves issues fast.',
  },
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function ServicesPage(): ReactElement {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />

      {/* ── PageHero ──────────────────────────────────────────────────── */}
      <PageHero
        eyebrow="Our Services"
        title="Professional Driver Hire for Every Journey"
        lead="From hourly city trips to Darjeeling day tours, Bagdogra airport transfers to corporate monthly plans — DriverZone connects you with verified local drivers at transparent, fixed fares."
        breadcrumbs={[{ label: 'Services' }]}
      />

      {/* ── Section 1: Services overview ─────────────────────────────── */}
      <section id="services-overview" className="bg-bg">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHead
            eyebrow="What we offer"
            title="Every kind of journey, covered"
            lead="Seven service types, one platform. Every booking goes to a driver who knows the route — and every price is confirmed before the trip begins."
          />

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICES.map((svc) => (
              <ServiceCard key={svc.title} svc={svc} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Section 2: Why DriverZone ─────────────────────────────────── */}
      <section id="why-driverzone" className="bg-bg-sunken">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHead
            eyebrow="Why DriverZone"
            title="Built around the passenger, not the platform"
            lead="Four principles that shape every booking — from the moment you open the app to when you reach your destination."
          />

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {WHY_ITEMS.map((item) => (
              <WhyCard key={item.title} item={item} />
            ))}
          </div>

          {/* Trust strip */}
          <div className="mt-10 grid gap-4 rounded-2xl border border-brand/40 bg-brand/10 p-8 sm:grid-cols-3">
            <Stat value="1,000+" label="Verified drivers in North Bengal" />
            <Stat value="₹399" label="Starting fare — transparent, no meter" />
            <Stat value="4.5 ★" label="Average passenger rating" />
          </div>
        </div>
      </section>

      {/* ── Section 3: CTA ────────────────────────────────────────────── */}
      <section id="book-now" className="bg-brand">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="flex flex-col items-center gap-8 text-center lg:flex-row lg:justify-between lg:text-left">
            <div className="max-w-xl">
              <p className="text-sm font-semibold uppercase tracking-wider text-fg/70">
                Ready to travel?
              </p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
                Book a driver in under 2 minutes
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-fg/80">
                Download the DriverZone app and book instantly, or reach us on WhatsApp and our
                team will arrange a driver for you — no app required.
              </p>
              <ul className="mt-6 space-y-2">
                {[
                  'Fare confirmed before you book',
                  'Driver arrives on time or we rebook free',
                  'Cash or online payment on trip completion',
                ].map((point) => (
                  <li key={point} className="flex items-center gap-2.5 text-[14px] text-fg">
                    <CheckCircle2 size={16} className="shrink-0 text-fg/70" aria-hidden />
                    {point}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <Link
                href="https://wa.me/918509299342?text=Hi%20DriverZone!%20I%20would%20like%20to%20book%20a%20driver."
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-pill bg-fg px-8 py-4 text-sm font-semibold text-on-fg transition-opacity hover:opacity-90"
              >
                <MessageCircle size={17} aria-hidden />
                Book via WhatsApp
              </Link>
              <Link
                href="tel:+918509299342"
                className="flex items-center justify-center gap-2 rounded-pill border-2 border-fg/40 px-8 py-4 text-sm font-medium text-fg/80 transition-colors hover:border-fg hover:text-fg"
              >
                <PhoneCall size={17} aria-hidden />
                Call Us
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 4: How It Works ───────────────────────────────────── */}
      <HowItWorksSection />
    </>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

function SectionHead({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}): ReactElement {
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
      <h2 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-fg sm:text-4xl">
        {title}
      </h2>
      {lead && (
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">{lead}</p>
      )}
    </div>
  );
}

function ServiceCard({ svc }: { svc: ServiceItem }): ReactElement {
  const Icon = svc.icon;
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-bg p-7 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand">
        <Icon size={22} className="text-fg" aria-hidden />
      </div>

      <div className="mt-5">
        <h3 className="text-lg font-bold text-fg">{svc.title}</h3>
        <span className="mt-1 inline-block rounded-pill bg-brand/20 px-3 py-0.5 text-[11px] font-semibold text-fg">
          {svc.tag}
        </span>
      </div>

      <p className="mt-4 text-[14px] leading-relaxed text-muted">{svc.description}</p>

      <ul className="mt-5 space-y-2 border-t border-border pt-5">
        {svc.points.map((pt) => (
          <li key={pt} className="flex items-start gap-2 text-[13px] text-fg">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" aria-hidden />
            {pt}
          </li>
        ))}
      </ul>
    </article>
  );
}

function WhyCard({ item }: { item: WhyItem }): ReactElement {
  const Icon = item.icon;
  return (
    <div className="rounded-2xl border border-border bg-bg p-7">
      <div className="flex size-11 items-center justify-center rounded-xl bg-brand">
        <Icon size={20} className="text-fg" aria-hidden />
      </div>
      <h3 className="mt-5 font-bold text-fg">{item.title}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">{item.body}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }): ReactElement {
  return (
    <div className="text-center sm:text-left">
      <p className="text-3xl font-bold text-fg">{value}</p>
      <p className="mt-1 text-[14px] text-fg/70">{label}</p>
    </div>
  );
}
