import Image from 'next/image';
import {
  BadgeCheck,
  Wallet,
  Headphones,
  Shield,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';

type Feature = { label: string; icon: LucideIcon };

const FEATURES: readonly Feature[] = [
  { label: 'Verified Drivers',         icon: BadgeCheck   },
  { label: 'Affordable Pricing',       icon: Wallet       },
  { label: '24/7 Service and Support', icon: Headphones   },
  { label: 'Safe & Trusted',           icon: Shield       },
  { label: 'On-Time Driver Reporting', icon: ClipboardList},
];

export function DriverWithUsSection(): ReactElement {
  return (
    <section id="driver-with-us" className="bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">

          {/* ── Left: text ───────────────────────────────────────────── */}
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-muted">
              Why Join Us
            </p>
            <h2 className="mt-1 text-3xl font-bold tracking-tight text-fg sm:text-4xl">
              Driver With Us
            </h2>

            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              DriverZone is your trusted partner for professional Driver Hire in Siliguri and Car
              Driver Hire in Siliguri. We specialise in providing skilled, punctual, and verified
              drivers for local commutes, outstation trips, and long-distance journeys. Our mission
              is to make every ride safe, comfortable, and hassle-free, ensuring peace of mind for
              all our customers.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-muted">
              With a commitment to excellence, we maintain a fleet of vehicles paired with drivers
              who know Siliguri and surrounding areas inside out. Every trip is handled with utmost
              professionalism, transparency, and care. Whether you need a driver for personal use,
              business travel, or special occasions, DriverZone guarantees dependable service and
              on-time arrival. Experience convenience, reliability, and safety combined, making us
              the preferred choice for driver services in Siliguri.
            </p>

            {/* Feature grid — 2 columns, last item spans if odd */}
            <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5">
              {FEATURES.map((feature) => {
                const Icon = feature.icon;
                return (
                  <li key={feature.label} className="flex items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand">
                      <Icon size={18} className="text-fg" aria-hidden />
                    </span>
                    <span className="text-[15px] font-medium text-fg">
                      {feature.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ── Right: photo ─────────────────────────────────────────── */}
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl md:aspect-auto md:h-full md:min-h-[460px]">
            <Image
              src="/why-choose.webp"
              alt="Two DriverZone team members reviewing driver documents at the Siliguri office"
              fill
              sizes="(min-width: 768px) 50vw, 100vw"
              className="object-cover"
            />
          </div>

        </div>
      </div>
    </section>
  );
}
