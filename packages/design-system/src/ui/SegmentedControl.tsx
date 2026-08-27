'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  segments: Segment<T>[];
  /** Announced as the group's name — "View", "Basemap". Required: a bare row of buttons has none. */
  label: string;
  className?: string | undefined;
}

/**
 * Two or three mutually exclusive VIEWS of the same data — map or list, streets or satellite.
 *
 * Not a tab set and not a filter. Tabs change what you are looking at; this changes how the
 * same thing is drawn, which is why the whole control is small enough to sit in a page header
 * next to the actions.
 *
 * `radiogroup` rather than a row of buttons, so a screen reader announces "2 of 2 selected"
 * instead of reading two unrelated controls. Selection is `interactive` ink on the muted
 * surface — never the accent fill, which at 1.18:1 against white would make the selected
 * segment the least visible one on the control.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  segments,
  label,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-0.5 p-0.5 rounded-md bg-surface-muted border border-border',
        className,
      )}
    >
      {segments.map((segment) => {
        const selected = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onValueChange(segment.value)}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-sm text-xs font-medium',
              'transition-colors focus-visible:outline-2 focus-visible:outline-interactive',
              selected
                ? 'bg-surface text-text border border-border'
                : 'border border-transparent text-text-subtle hover:text-text',
            )}
          >
            {segment.icon}
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
