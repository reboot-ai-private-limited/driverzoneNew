import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import type { ReactElement } from 'react';
import { ALL_PACKAGES } from '@/lib/packages-data';
import type { PackageItem } from '@/lib/packages-data';

const PREVIEW_COUNT = 9;
const PACKAGES = ALL_PACKAGES.slice(0, PREVIEW_COUNT);

type Package = PackageItem;

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

        {/* ── View all CTA ──────────────────────────────────────────────── */}
        <div className="mt-10 text-center">
          <Link
            href="/packages"
            className="inline-flex items-center gap-2 rounded-pill border border-border-strong bg-bg px-8 py-3 text-sm font-semibold text-fg transition-colors hover:bg-brand hover:border-brand"
          >
            View All {ALL_PACKAGES.length} Packages
          </Link>
        </div>
      </div>
    </section>
  );
}

const WA_NUMBER = '918509299342';

function PackageCard({ pkg }: { pkg: Package }): ReactElement {
  const waMsg = `Hello DriverZone! I am interested in the "${pkg.title}" package (${pkg.price} / ${pkg.duration}). Please confirm availability and pricing. Thank you!`;
  const waHref = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(waMsg)}`;

  return (
    <article className="relative flex flex-col rounded-3xl border border-border bg-bg p-3 transition-all duration-300 hover:shadow-lg">
      {pkg.badge && (
        <span className="absolute right-5 top-5 z-10 rounded-pill bg-brand px-3 py-0.5 text-[11px] font-bold text-fg shadow">
          {pkg.badge}
        </span>
      )}

      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
        <Image
          src={pkg.image}
          alt={pkg.imageAlt}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          quality={85}
          className="object-cover"
        />
        <span className="absolute bottom-2 left-3 rounded-pill bg-black/60 px-3 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
          {pkg.category}
        </span>
      </div>

      <div className="flex flex-1 flex-col px-3 pb-3 pt-5">
        <h3 className="text-xl font-bold text-fg">{pkg.title}</h3>

        <div className="mt-2">
          <span className="text-2xl font-bold text-success">{pkg.price}/-</span>
          <p className="mt-0.5 text-sm text-muted">
            {pkg.duration} · {pkg.priceNote}
          </p>
        </div>

        <ul className="mt-4 space-y-2">
          {pkg.features.map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-[14px] text-fg">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
              {feature}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex gap-3">
          <Link
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-pill bg-brand py-3 text-center text-sm font-semibold text-fg transition-opacity hover:opacity-90 active:scale-[0.97]"
          >
            Book Now!
          </Link>
          <Link
            href="/contact"
            className="flex-1 rounded-pill border border-border py-3 text-center text-sm font-medium text-fg transition-colors hover:border-border-strong hover:bg-bg-sunken active:scale-[0.97]"
          >
            Enquire
          </Link>
        </div>
      </div>
    </article>
  );
}
