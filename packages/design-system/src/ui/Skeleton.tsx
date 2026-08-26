'use client';

import { cn } from './cn';

/**
 * A skeleton reproduces the REAL geometry of what it replaces — the same widths, the same row
 * count. That is the whole reason to prefer it to a spinner: the page does not reflow when the
 * data lands, and the shape tells the user what is coming.
 *
 * One animation speed on a page. Two different shimmers read as two things loading at
 * different rates, which is not what is happening.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('bg-surface-muted rounded-sm animate-pulse h-4 w-full', className)}
    />
  );
}

export interface SkeletonTableProps {
  rows?: number;
  /** Tailwind width classes, one per column — the real column widths, not equal thirds. */
  columns: string[];
}

export function SkeletonTable({ rows = 8, columns }: SkeletonTableProps) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-border">
      {Array.from({ length: rows }, (_, r) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={r} className="flex items-center gap-4 px-4 h-11">
          {columns.map((width, c) => (
            // eslint-disable-next-line react/no-array-index-key
            <Skeleton key={c} className={cn('h-3.5', width)} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonFieldList({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="divide-y divide-border">
      {Array.from({ length: rows }, (_, r) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={r} className="flex items-center justify-between gap-4 py-2.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
