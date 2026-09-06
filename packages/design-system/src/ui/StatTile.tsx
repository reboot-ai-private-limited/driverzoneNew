'use client';

import type { ReactNode } from 'react';
import { Skeleton } from './Skeleton';
import { cn } from './cn';

export type StatTileTone = 'default' | 'success' | 'danger' | 'warning';

const TONES: Record<StatTileTone, string> = {
  default: 'text-text',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
};

export interface StatTileProps {
  label: string;
  /**
   * PREFORMATTED. A tile never formats money — it is handed `Money.amount_display` (or the
   * output of `formatPaise`) and renders it. A component that took paise and formatted them
   * would be the fifth place in this product that decides what a rupee looks like.
   */
  value: ReactNode;
  icon?: ReactNode;
  /** Colours the VALUE, not the tile. A red tile reads as an error; a red number reads as debt. */
  tone?: StatTileTone;
  /** The denominator — "across 41 drivers", "this month". Small, under the value. */
  hint?: ReactNode;
  /** A badge beside the value, for a state the number alone cannot say ("Suspended"). */
  badge?: ReactNode;
  /**
   * Renders the tile's own skeleton at its real height.
   *
   * This is the reason the component exists. Every hand-rolled tile in this codebase came with
   * a hand-rolled `animate-pulse` div of a guessed height, and the guess is what makes the page
   * jump when the data lands. The skeleton lives with the thing it stands in for.
   */
  loading?: boolean;
  className?: string | undefined;
}

/**
 * One number, labelled. The unit a finance or dashboard screen is built out of.
 *
 * Bordered but deliberately plain — no shadow, no tinted background (design-language.md
 * §Principles). A row of these should read as a row of facts, not as cards competing with the
 * table under them.
 */
export function StatTile({
  label,
  value,
  icon,
  tone = 'default',
  hint,
  badge,
  loading = false,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn('flex flex-col rounded-md border border-border bg-surface p-4', className)}
      // `aria-busy` rather than swapping in a role="status": the tile keeps its label while
      // loading, so a screen reader announces what is arriving, not just that something is.
      aria-busy={loading || undefined}
    >
      <div className="mb-2 flex items-center gap-2 text-text-subtle">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>

      {loading ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <div className="flex items-end gap-2">
          <span className={cn('text-2xl font-semibold tnum', TONES[tone])}>{value}</span>
          {badge !== undefined && <span className="mb-1">{badge}</span>}
        </div>
      )}

      {hint !== undefined && !loading && (
        <span className="mt-1 text-xs text-text-subtle">{hint}</span>
      )}
    </div>
  );
}
