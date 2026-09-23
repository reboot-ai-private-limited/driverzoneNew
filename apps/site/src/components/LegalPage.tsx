import type { ReactElement, ReactNode } from 'react';
import { PageHero } from '@/components/PageHero';
import { LEGAL_LAST_UPDATED } from '@/lib/site';

/**
 * The shell the three legal pages share — privacy, terms, and account deletion.
 *
 * It carries the typography rather than each page repeating it, and that is not only tidiness:
 * these pages are long prose with nested lists and sub-headings, and Tailwind resets every
 * element's margins to zero. Styling them per-page means three chances to get the rhythm subtly
 * different on documents that a reader may well open side by side.
 *
 * The descendant selectors below do the work instead of `@tailwindcss/typography`, which would be
 * a dependency for three pages and would then need overriding back to the brand's ink and link
 * colours anyway.
 */
export function LegalPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <PageHero eyebrow="Legal" title={title} lead={lead} />

      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <p className="text-sm text-faint">Last updated: {LEGAL_LAST_UPDATED}</p>

        <div
          className={[
            'mt-10 space-y-12',
            '[&_p]:text-[17px] [&_p]:leading-relaxed [&_p]:text-muted',
            '[&_li]:text-[17px] [&_li]:leading-relaxed [&_li]:text-muted',
            '[&_ul]:mt-4 [&_ul]:space-y-3 [&_ul]:pl-5 [&_li]:list-disc',
            '[&_h3]:mt-8 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-fg',
            '[&_strong]:font-semibold [&_strong]:text-fg',
            '[&_a]:font-medium [&_a]:text-link [&_a]:underline [&_a]:underline-offset-4',
          ].join(' ')}
        >
          {children}
        </div>
      </div>
    </>
  );
}

/** One numbered-feeling block: a heading and its prose. */
export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-bold tracking-tight text-fg">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
