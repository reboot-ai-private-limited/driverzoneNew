import type { ReactElement } from 'react';

/**
 * The banner every inner page opens with — about, contact, and the three legal pages.
 *
 * Shared, unlike the home page's `Section`, because these five pages genuinely are the same shape:
 * a short yellow band, then a single column of prose. The home page is not one of them, which is
 * why its sections stayed local to `page.tsx`.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}): ReactElement {
  return (
    <section className="border-b border-border bg-brand-soft">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-wider text-muted">{eyebrow}</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-fg sm:text-5xl">{title}</h1>
        {lead === undefined ? null : (
          <p className="mt-5 text-lg leading-relaxed text-muted">{lead}</p>
        )}
      </div>
    </section>
  );
}
