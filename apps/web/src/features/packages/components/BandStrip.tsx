'use client';

import { formatBand, stripCells, type CoverageSegment } from '../lib/band';

/**
 * The distance ladder, drawn.
 *
 * This existed once as the outstation LIST and was replaced by a table, correctly: a bar cannot
 * hold a one-way fare, a return fare and a commission split, so reading it meant hovering every
 * segment. It comes back as a HEADER for that table, which is the job it was always suited to.
 * The table below carries every number; the strip carries the one fact a column of ranges makes
 * you reconstruct in your head — the shape. That a band is twice as wide as its neighbour, and
 * that the hole between two of them is wider than either, are spatial facts, and this is the
 * only place on the screen they are shown as such.
 *
 * The red hatch is a distance nobody has priced. It is also a red row in the table, on purpose:
 * an overlap is refused at write time, caught again by the nightly job and made deterministic by
 * read-time precedence, while a gap is caught by nobody, because nothing is wrong with any
 * individual band. Two adjacent bands failing to meet is a silence, and it is worth breaking
 * twice.
 *
 * Hatched rather than merely red — hue alone is not a signal
 * (docs/engineering/design-language.md §Color), and `var(--color-danger)` keeps the gradient
 * inside the semantic-token contract that a raw hex would step outside of.
 */

export interface BandStripProps {
  segments: CoverageSegment[];
  /** Routing stays with the parent, the way `OutstationView` already owns every `router.push`. */
  onSelect: (segment: CoverageSegment) => void;
}

const GAP_HATCH =
  'bg-[repeating-linear-gradient(45deg,transparent_0_5px,color-mix(in_srgb,var(--color-danger)_22%,transparent)_5px_6px)]';

export function BandStrip({ segments, onSelect }: BandStripProps) {
  const cells = stripCells(segments);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-9 rounded-md border border-border overflow-hidden">
        {cells.map(({ segment, weight }) => {
          const range = formatBand(segment.from, segment.to);
          const covered = segment.kind === 'covered';
          const label = covered ? (segment.name ?? range) : range;

          return (
            <button
              key={`${segment.kind}-${segment.from}`}
              type="button"
              style={{ flexGrow: weight, flexBasis: 0 }}
              onClick={() => onSelect(segment)}
              title={covered ? `${label} · ${range}` : `${range} — no band`}
              aria-label={covered ? `${label}, ${range}` : `${range}, no band — add one`}
              className={[
                'min-w-0 px-2 text-xs truncate text-left border-r border-border last:border-r-0',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-interactive focus-visible:ring-inset',
                covered
                  ? 'bg-surface-muted text-text hover:bg-surface-sunken'
                  : `${GAP_HATCH} text-danger font-medium hover:brightness-95`,
              ].join(' ')}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/*
        The km axis, sharing the bar's weights so every number sits under its own boundary. Labels
        START at their boundary rather than straddling it — centring each one would need it pulled
        half its own width left, which the first label (always `0`, always flush) cannot do.
        The bar is the picture; these are read against it, not on their own.
      */}
      <div className="flex text-[11px] text-text-subtle tabular-nums" aria-hidden="true">
        {cells.map(({ segment, weight }) => (
          <span
            key={`axis-${segment.kind}-${segment.from}`}
            style={{ flexGrow: weight, flexBasis: 0 }}
            className="min-w-0 truncate"
          >
            {segment.from}
          </span>
        ))}
      </div>
    </div>
  );
}
