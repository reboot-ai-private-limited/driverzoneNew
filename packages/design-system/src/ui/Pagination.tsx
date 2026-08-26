'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from './cn';

export interface PaginationProps {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/**
 * Numbered pills with an ellipsis, plus the count sentence on the left.
 *
 * "Showing 1 to 10 of 128" is not decoration: without it, an admin filtering a list has no way
 * to tell whether the filter matched 10 things or 10,000, which is exactly the question a
 * filter is asked to answer.
 */
export function Pagination({ page, pageCount, total, pageSize, onPageChange }: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between gap-4 px-4 h-12 border-t border-border">
      <p className="text-xs text-text-subtle tnum">
        Showing {from} to {to} of {total}
      </p>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <PageButton
          label="Previous page"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden className="size-4" />
        </PageButton>

        {pageNumbers(page, pageCount).map((p, i) =>
          p === null ? (
            // eslint-disable-next-line react/no-array-index-key
            <span key={`gap-${i}`} className="px-1 text-xs text-text-subtle">
              …
            </span>
          ) : (
            <PageButton
              key={p}
              label={`Page ${p}`}
              current={p === page}
              onClick={() => onPageChange(p)}
            >
              {p}
            </PageButton>
          ),
        )}

        <PageButton
          label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight aria-hidden className="size-4" />
        </PageButton>
      </nav>
    </div>
  );
}

function PageButton({
  label,
  current,
  disabled,
  onClick,
  children,
}: {
  label: string;
  current?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={current === true ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center size-8 rounded-sm text-xs tnum',
        'disabled:opacity-40 disabled:pointer-events-none',
        // The accent fill with dark ink — the only way the lime can carry a label.
        current === true
          ? 'bg-accent text-accent-ink font-medium'
          : 'text-text hover:bg-surface-muted',
      )}
    >
      {children}
    </button>
  );
}

/** Current page always flanked by one neighbour, first and last always shown, gaps elided. */
function pageNumbers(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);

  const out: (number | null)[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pageCount - 1, page + 1);

  if (start > 2) out.push(null);
  for (let p = start; p <= end; p += 1) out.push(p);
  if (end < pageCount - 1) out.push(null);
  out.push(pageCount);

  return out;
}
