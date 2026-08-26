'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export interface PanelProps {
  /** Optional heading. A panel with no title is just a bordered box, which is fine. */
  title?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Remove the body padding — for a panel whose entire content is a table. */
  flush?: boolean;
}

/**
 * A bordered container. NO SHADOW — see docs/engineering/design-language.md §Principles.
 *
 * Reach for this only when the content is a genuinely separate object, like one of the grouped
 * field lists on a detail screen. The default container in this design is nothing at all: a
 * heading, a hairline, content. A list inside a card inside a card is what this restraint
 * exists to prevent.
 */
export function Panel({ title, icon, actions, children, className, flush }: PanelProps) {
  return (
    <section className={cn('bg-surface border border-border rounded-md', className)}>
      {(title !== undefined || actions !== undefined) && (
        <header className="flex items-center justify-between gap-4 px-4 h-12 border-b border-border">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
            {icon}
            {title}
          </h2>
          {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={flush === true ? undefined : 'p-4'}>{children}</div>
    </section>
  );
}

/**
 * The label→value rows on a detail screen. Label left in subtle ink, value right in body ink,
 * hairline between.
 */
export function DefinitionList({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-border">{children}</dl>;
}

export function FieldRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-xs text-text-subtle shrink-0">{label}</dt>
      <dd className="text-sm text-text text-right">{children}</dd>
    </div>
  );
}
