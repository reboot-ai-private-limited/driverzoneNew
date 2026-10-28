'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { ALL_PACKAGES, CATEGORIES } from '@/lib/packages-data';
import type { PackageCategory, PackageItem } from '@/lib/packages-data';

const PAGE_SIZE = 12;
const WA_NUMBER = '918509299342';

function buildWaLink(pkg: PackageItem): string {
  const msg = `Hello DriverZone! I am interested in the "${pkg.title}" package (${pkg.price} / ${pkg.duration}). Please confirm availability and pricing. Thank you!`;
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`;
}

/* ── Filter pill ─────────────────────────────────────────────────────────── */
function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-pill border px-5 py-2 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
        active
          ? 'border-brand bg-brand text-fg shadow-sm'
          : 'border-border bg-bg text-muted hover:border-border-strong hover:text-fg'
      }`}
    >
      {label}
    </button>
  );
}

/* ── Package card ────────────────────────────────────────────────────────── */
function PackageCard({ pkg }: { pkg: PackageItem }): ReactElement {
  return (
    <article className="relative flex flex-col rounded-3xl border border-border bg-bg p-3 transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5">
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
          {pkg.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-[13px] text-fg">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-hidden />
              {f}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex gap-3">
          <Link
            href={buildWaLink(pkg)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 rounded-pill bg-brand py-3 text-center text-sm font-semibold text-fg transition-opacity hover:opacity-90 active:scale-[0.97]"
          >
            Book Now
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

/* ── Pagination bar ──────────────────────────────────────────────────────── */
function Pagination({
  page,
  total,
  onGo,
}: {
  page: number;
  total: number;
  onGo: (n: number) => void;
}): ReactElement {
  return (
    <nav aria-label="Package pages" className="mt-10 flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => onGo(page - 1)}
        disabled={page === 1}
        aria-label="Previous page"
        className="flex size-10 items-center justify-center rounded-full border border-border text-fg transition-colors hover:bg-bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft size={18} aria-hidden />
      </button>

      {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onGo(n)}
          aria-label={`Page ${n}`}
          aria-current={n === page ? 'page' : undefined}
          className={`flex size-10 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
            n === page
              ? 'bg-brand text-fg shadow-sm'
              : 'border border-border text-muted hover:bg-bg-sunken hover:text-fg'
          }`}
        >
          {n}
        </button>
      ))}

      <button
        type="button"
        onClick={() => onGo(page + 1)}
        disabled={page === total}
        aria-label="Next page"
        className="flex size-10 items-center justify-center rounded-full border border-border text-fg transition-colors hover:bg-bg-sunken disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight size={18} aria-hidden />
      </button>
    </nav>
  );
}

/* ── Main exported component ─────────────────────────────────────────────── */
export function PackagesGrid(): ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const topRef = useRef<HTMLElement>(null);

  const rawPage = Number(searchParams.get('page') ?? '1');
  const [activeCategory, setActiveCategory] = useState<PackageCategory | 'All'>('All');

  const filtered =
    activeCategory === 'All'
      ? ALL_PACKAGES
      : ALL_PACKAGES.filter((p) => p.category === activeCategory);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const page = Math.min(Math.max(1, isNaN(rawPage) ? 1 : rawPage), totalPages);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const goToPage = useCallback(
    (n: number) => {
      const clamped = Math.min(Math.max(1, n), totalPages);
      const params = new URLSearchParams(searchParams.toString());
      if (clamped === 1) {
        params.delete('page');
      } else {
        params.set('page', String(clamped));
      }
      const query = params.toString();
      router.push(`/packages${query ? `?${query}` : ''}`, { scroll: false });
      // Scroll the grid section into view (below the sticky header)
      setTimeout(() => {
        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    },
    [router, searchParams, totalPages],
  );

  const handleCategory = useCallback(
    (cat: PackageCategory | 'All') => {
      setActiveCategory(cat);
      // Reset to page 1 and clear page param when filter changes
      const params = new URLSearchParams(searchParams.toString());
      params.delete('page');
      const query = params.toString();
      router.push(`/packages${query ? `?${query}` : ''}`, { scroll: false });
    },
    [router, searchParams],
  );

  return (
    <section ref={topRef} id="packages-grid" className="bg-bg scroll-mt-24">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">

        {/* Filter pills */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            label={`All (${ALL_PACKAGES.length})`}
            active={activeCategory === 'All'}
            onClick={() => handleCategory('All')}
          />
          {CATEGORIES.map((cat) => {
            const count = ALL_PACKAGES.filter((p) => p.category === cat).length;
            return (
              <FilterPill
                key={cat}
                label={`${cat} (${count})`}
                active={activeCategory === cat}
                onClick={() => handleCategory(cat)}
              />
            );
          })}
        </div>

        {/* Count label */}
        <p className="mt-4 text-sm text-muted">
          Showing{' '}
          <span className="font-semibold text-fg">{visible.length}</span> of{' '}
          <span className="font-semibold text-fg">{filtered.length}</span> packages
          {activeCategory !== 'All' && (
            <> in <span className="font-semibold text-fg">{activeCategory}</span></>
          )}
          {' '}— Page <span className="font-semibold text-fg">{page}</span> of{' '}
          <span className="font-semibold text-fg">{totalPages}</span>
        </p>

        {/* Cards */}
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((pkg) => (
            <PackageCard key={pkg.id} pkg={pkg} />
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <Pagination page={page} total={totalPages} onGo={goToPage} />
        )}
      </div>
    </section>
  );
}
