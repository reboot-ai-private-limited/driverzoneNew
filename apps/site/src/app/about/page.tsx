import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import Image from 'next/image';
import {
  BadgeCheck,
  Wallet,
  Headphones,
  Shield,
  ClipboardList,
  Car,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { PageHero } from '@/components/PageHero';
import { SITE_URL } from '@/lib/site';

/* ── SEO ─────────────────────────────────────────────────────────────────── */

export const metadata: Metadata = {
  title: 'About Driver Zone — Reliable Driver Hire Services in Siliguri',
  description:
    'DriverZone is your trusted partner for professional Driver Hire in Siliguri and Car Driver Hire in Siliguri. Verified drivers, luxury vehicles, safe & reliable travel for local commutes, outstation trips, and long-distance journeys.',
  alternates: {
    canonical: `${SITE_URL}/about`,
  },
  openGraph: {
    title: 'About Driver Zone — Reliable Driver Hire Services in Siliguri',
    description:
      'DriverZone is your trusted partner for professional Driver Hire in Siliguri. Verified drivers, luxury vehicles, safe & reliable travel for local and outstation trips.',
    url: `${SITE_URL}/about`,
    siteName: 'Driver Zone',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/why-choose.webp`,
        width: 1200,
        height: 630,
        alt: 'DriverZone team — professional driver hire services in Siliguri',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About Driver Zone — Reliable Driver Hire Services in Siliguri',
    description:
      'DriverZone is your trusted partner for professional Driver Hire in Siliguri. Verified drivers, safe & reliable travel.',
    images: [`${SITE_URL}/why-choose.webp`],
  },
};

/* ── Data ────────────────────────────────────────────────────────────────── */

type Feature = { label: string; icon: LucideIcon };

const FEATURES: readonly Feature[] = [
  { label: 'Verified Drivers',          icon: BadgeCheck    },
  { label: 'Affordable Pricing',        icon: Wallet        },
  { label: '24/7 Service and Support',  icon: Headphones    },
  { label: 'Safe & Trusted',            icon: Shield        },
  { label: 'On-Time Driver Reporting',  icon: ClipboardList },
];

type Card = { title: string; icon: LucideIcon; body: string };

const CARDS: readonly Card[] = [
  {
    title: 'Our Mission',
    icon: Car,
    body: 'DriverZone is your trusted partner for professional Driver Hire in Siliguri and Car Driver Hire in Siliguri. We specialize in providing skilled, punctual, and verified drivers for local commutes, outstation trips, and long-distance journeys. Our mission is to make every ride safe, comfortable, and hassle-free, ensuring peace of mind for all our customers. With a commitment to excellence, we maintain a luxury fleet of vehicles, paired with drivers who know Siliguri and surrounding areas inside out. Every trip is handled with utmost professionalism, transparency, and care. Whether you need a driver for personal use, business travel, or special occasions, DriverZone guarantees dependable service and on-time arrival. Experience convenience, reliability, and safety combined, making us the preferred choice for driver services in Siliguri.',
  },
  {
    title: 'Our Vision',
    icon: Globe,
    body: 'DriverZone is your trusted partner for professional Driver Hire in Siliguri and Car Driver Hire in Siliguri. We specialize in providing skilled, punctual, and verified drivers for local commutes, outstation trips, and long-distance journeys. Our mission is to make every ride safe, comfortable, and hassle-free, ensuring peace of mind for all our customers. With a commitment to excellence, we maintain a luxury fleet of vehicles, paired with drivers who know Siliguri and surrounding areas inside out. Every trip is handled with utmost professionalism, transparency, and care. Whether you need a driver for personal use, business travel, or special occasions, DriverZone guarantees dependable service and on-time arrival. Experience convenience, reliability, and safety combined, making us the preferred choice for driver services in Siliguri.',
  },
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AboutPage(): ReactElement {
  return (
    <>
      <PageHero
        eyebrow="About Driver Zone"
        title="Reliable Driver Hire Services Siliguri"
        breadcrumbs={[{ label: 'About Driver Zone' }]}
      />

      {/* ── Section 1: Two-column intro ─────────────────────────────────── */}
      <section className="bg-bg">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">

            {/* Left — text + features */}
            <div>
              <p className="text-[15px] leading-relaxed text-muted">
                DriverZone is your trusted partner for professional Driver Hire in Siliguri and Car
                Driver Hire in Siliguri. We specialize in providing skilled, punctual, and verified
                drivers for local commutes, outstation trips, and long-distance journeys. Our mission
                is to make every ride safe, comfortable, and hassle-free, ensuring peace of mind for
                all our customers.
              </p>
              <p className="mt-4 text-[15px] leading-relaxed text-muted">
                With a commitment to excellence, we maintain a luxury fleet of vehicles, paired with
                drivers who know Siliguri and surrounding areas inside out. Every trip is handled
                with utmost professionalism, transparency, and care. Whether you need a driver for
                personal use, business travel, or special occasions, DriverZone guarantees dependable
                service and on-time arrival. Experience convenience, reliability, and safety
                combined, making us the preferred choice for driver services in Siliguri.
              </p>

              {/* Feature grid */}
              <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5">
                {FEATURES.map((f) => {
                  const Icon = f.icon;
                  return (
                    <li key={f.label} className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand">
                        <Icon size={18} className="text-fg" aria-hidden />
                      </span>
                      <span className="text-[14px] font-medium text-fg">{f.label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Right — photo */}
            <div className="relative aspect-[4/3] overflow-hidden rounded-2xl md:aspect-auto md:h-full md:min-h-[460px]">
              <Image
                src="/why-choose.webp"
                alt="DriverZone team reviewing driver documents at the Siliguri office"
                fill
                sizes="(min-width: 768px) 50vw, 100vw"
                className="object-cover"
                priority
              />
            </div>

          </div>
        </div>
      </section>

      {/* ── Section 2: Mission & Vision cards ───────────────────────────── */}
      <section className="bg-bg-sunken">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-6 md:grid-cols-2">
            {CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="flex flex-col items-center rounded-2xl border border-brand/30 bg-bg px-8 py-10 text-center shadow-sm"
                >
                  <span className="flex size-14 items-center justify-center rounded-full bg-brand">
                    <Icon size={26} className="text-fg" aria-hidden />
                  </span>
                  <h2 className="mt-4 text-xl font-bold text-fg">{card.title}</h2>
                  <p className="mt-4 text-[14px] leading-relaxed text-muted">{card.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}
