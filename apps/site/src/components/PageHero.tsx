import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';
import type { ReactElement } from 'react';

type Crumb = { label: string; href?: string };

/**
 * The banner every inner page opens with — about, contact, and the legal pages.
 *
 * Pass `breadcrumbs` to render a breadcrumb trail above the eyebrow.
 * The last crumb is always the current page (no link); preceding crumbs are links.
 * "Home" is prepended automatically — do not include it in the array.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  breadcrumbs,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  breadcrumbs?: readonly Crumb[];
}): ReactElement {
  const allCrumbs: readonly Crumb[] = breadcrumbs
    ? [{ label: 'Home', href: '/' }, ...breadcrumbs]
    : [];

  return (
    <section className="border-b border-border bg-gradient-to-t from-brand-soft to-white">
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6">

        {/* ── Breadcrumbs ──────────────────────────────────────────────── */}
        {allCrumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-4">
            <ol className="flex flex-wrap items-center gap-1 text-[13px] text-muted">
              {allCrumbs.map((crumb, i) => {
                const isLast = i === allCrumbs.length - 1;
                return (
                  <li key={crumb.label} className="flex items-center gap-1">
                    {i === 0 && (
                      <Home size={13} className="shrink-0 text-muted" aria-hidden />
                    )}
                    {isLast ? (
                      <span aria-current="page" className="font-medium text-fg">
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        href={crumb.href ?? '/'}
                        className="transition-colors hover:text-fg"
                      >
                        {crumb.label}
                      </Link>
                    )}
                    {!isLast && (
                      <ChevronRight size={13} className="shrink-0 text-muted/60" aria-hidden />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}

        {/* ── Eyebrow + heading + lead ──────────────────────────────────── */}
        <p className="text-sm font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-fg sm:text-5xl">{title}</h1>
        {lead === undefined ? null : (
          <p className="mt-5 text-lg leading-relaxed text-muted">{lead}</p>
        )}

      </div>
    </section>
  );
}
