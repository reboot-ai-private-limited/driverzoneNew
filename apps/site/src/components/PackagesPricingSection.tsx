import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import type { ReactElement } from 'react';

type Package = {
  id: string;
  image: string;
  imageAlt: string;
  title: string;
  price: string;
  duration: string;
  features: readonly string[];
  bookHref: string;
  moreHref: string;
};

const PACKAGES: readonly Package[] = [
  {
    id: 'in-city-one-way',
    image: '/packages/in-city-one-way.webp',
    imageAlt: 'Scenic destination for an in-city one-way trip',
    title: 'In-City One Way',
    price: '₹399/-',
    duration: 'For 3 hours',
    features: ['Overtime after 3 hrs: ₹99/hours', 'Driver food: Not included'],
    bookHref: '/#get-the-app',
    moreHref: '/#services',
  },
  {
    id: 'in-city-round-trip',
    image: '/packages/in-city-round-trip.webp',
    imageAlt: 'Scenic destination for an in-city round trip',
    title: 'In-City Round Trip',
    price: '₹399/-',
    duration: 'For 3 hours',
    features: ['Overtime after 3 hrs: ₹99/hours', 'Driver food: Not included'],
    bookHref: '/#get-the-app',
    moreHref: '/#services',
  },
  {
    id: 'mini-outstation-one-way',
    image: '/packages/mini-outstation-one-way.webp',
    imageAlt: 'Scenic destination for a mini outstation one-way journey',
    title: 'Mini Outstation One Way',
    price: '₹399/-',
    duration: 'For 3 hours',
    features: ['Overtime after 3 hrs: ₹99/hours', 'Driver food: Not included'],
    bookHref: '/#get-the-app',
    moreHref: '/#services',
  },
];

export function PackagesPricingSection(): ReactElement {
  return (
    <section id="packages-pricing" className="bg-bg-sunken">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        {/* ── Heading — centered ─────────────────────────────────────────── */}
        <div className="mx-auto max-w-6xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
            Packages &amp; Pricing
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Choose from flexible, transparent packages designed for every need. From hourly city
            trips to full-day outstation journeys,{' '}
            <strong className="font-semibold text-fg">DriverZone</strong> offers competitive rates
            for reliable Driver Hire in Siliguri services.
          </p>
        </div>

        {/* ── Cards grid ────────────────────────────────────────────────── */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PACKAGES.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PackageCard({ pkg }: { pkg: Package }): ReactElement {
  return (
    <article className="flex flex-col rounded-3xl border border-border bg-bg p-3 transition-all duration-300 hover:shadow-lg">
      {/* Inset image — padded inside the card with its own border-radius */}
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl">
        <Image
          src={pkg.image}
          alt={pkg.imageAlt}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
        />
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col px-3 pb-3 pt-5">
        <h3 className="text-xl font-bold text-fg">{pkg.title}</h3>

        {/* Price */}
        <div className="mt-2">
          <span className="text-2xl font-bold text-success">{pkg.price}</span>
          <p className="mt-0.5 text-sm text-muted">{pkg.duration}</p>
        </div>

        {/* Features */}
        <ul className="mt-4 space-y-2">
          {pkg.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-[14px] text-fg">
              <CheckCircle2
                size={16}
                className="shrink-0 text-success"
                aria-hidden
              />
              {feature}
            </li>
          ))}
        </ul>

        {/* Buttons */}
        <div className="mt-6 flex gap-3">
          <Link
            href={pkg.bookHref}
            className="flex-1 rounded-pill bg-brand py-3 text-center text-sm font-semibold text-fg transition-opacity hover:opacity-90 active:scale-[0.97]"
          >
            Book Now!
          </Link>
          <Link
            href={pkg.moreHref}
            className="flex-1 rounded-pill border border-border py-3 text-center text-sm font-medium text-fg transition-colors hover:border-border-strong hover:bg-bg-sunken active:scale-[0.97]"
          >
            Know More
          </Link>
        </div>
      </div>
    </article>
  );
}
