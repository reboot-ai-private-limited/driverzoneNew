'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ReactElement } from 'react';

export type FaqItem = {
  q: string;
  a: string;
};

/**
 * Controlled accordion — only one item open at a time.
 * Animation uses the CSS grid-rows trick: grid-rows-[0fr] → grid-rows-[1fr]
 * with an overflow-hidden inner wrapper, which avoids the max-height hack.
 */
export function FaqAccordion({ items }: { items: readonly FaqItem[] }): ReactElement {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <dl className="space-y-4">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div
            key={item.q}
            className="overflow-hidden rounded-2xl border border-border bg-bg"
          >
            <dt>
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
              >
                <span>{item.q}</span>
                <ChevronDown
                  size={18}
                  aria-hidden
                  className={`shrink-0 text-muted transition-transform duration-300 ease-in-out ${
                    isOpen ? 'rotate-180' : 'rotate-0'
                  }`}
                />
              </button>
            </dt>
            {/* grid-rows trick: 0fr collapses to 0, 1fr expands to content height */}
            <dd
              className={`grid transition-all duration-300 ease-in-out ${
                isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
              }`}
            >
              <div className="overflow-hidden">
                <p className="px-6 pb-5 pt-0 text-[15px] leading-relaxed text-muted">
                  {item.a}
                </p>
              </div>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
