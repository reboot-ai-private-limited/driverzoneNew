'use client';

import { AlertTriangle, CheckCircle2, Crosshair, Loader2, XCircle } from 'lucide-react';
import type { ZoneViolationDto } from '@driverzone/contracts';
import type { Polygon } from '@driverzone/geo';
import { Button, cn } from '@driverzone/design-system';

/**
 * The live verdict, rendered as the admin draws.
 *
 * TWO RULES THIS COMPONENT EXISTS TO ENFORCE:
 *
 * 1. **`message` is rendered verbatim.** It arrives already written for a person — "Overlaps
 *    'Siliguri Central' by 0.42 km²" — from the same `@driverzone/geo` rule the API refuses the
 *    save with. Building copy from `rule` here would mean a rule added later renders as a blank
 *    or a fallback string (docs/engineering/coding-standards.md §Frontend).
 *
 * 2. **Severity is not decoration.** An ERROR blocks the save; `Z-COMPLEXITY` is a WARN and
 *    must not. Treating them alike in either direction is a bug: one refuses a legal 600-vertex
 *    hill zone, the other lets a self-intersecting polygon reach an API that will reject it
 *    anyway, after the admin has stopped watching.
 *
 * `[Show on map]` is the payload of `offending_geometry`. "There is an overlap" tells an admin
 * they have a problem; painting the 0.42 km² tells them which corner to drag. That is the whole
 * reason the violation carries derived geometry — something Mongo cannot produce at all, which
 * is why Turf computes it server-side (docs/LLD/zones.md).
 */

export interface ZoneViolationsProps {
  violations: ZoneViolationDto[];
  confirming: boolean;
  /** Nothing drawn yet — a blank editor is not a passing verdict, and must not look like one. */
  empty: boolean;
  onShowOnMap: (geometry: Polygon) => void;
}

export function ZoneViolations({
  violations,
  confirming,
  empty,
  onShowOnMap,
}: ZoneViolationsProps) {
  if (empty) {
    return (
      <p className="text-xs text-text-subtle">
        Click on the map to place corners. Double-click or press{' '}
        <kbd className="font-mono text-text">Enter</kbd> to close the shape,{' '}
        <kbd className="font-mono text-text">Esc</kbd> to start over — or import a boundary.
      </p>
    );
  }

  if (violations.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-success">
        {confirming ? (
          <Loader2 aria-hidden className="size-3.5 animate-spin" />
        ) : (
          <CheckCircle2 aria-hidden className="size-3.5" />
        )}
        {/*
          The distinction is honest rather than pedantic. Until the server has seen this exact
          shape, the verdict is the browser's — computed from a cached sibling list that another
          admin's save may already have invalidated.
        */}
        {confirming ? 'Checking against saved zones…' : 'No problems with this boundary.'}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {violations.map((violation, index) => {
        const error = violation.severity === 'ERROR';
        return (
          <li
            // The rule alone is not unique — two overlaps are two Z-2s — and there is no id on
            // the wire. The pair is stable for a given verdict, which is all this list needs.
            // eslint-disable-next-line react/no-array-index-key
            key={`${violation.rule}-${index}`}
            className={cn(
              'flex items-start gap-2 text-xs rounded-sm p-2',
              error ? 'bg-danger/5 text-danger' : 'bg-warning/5 text-warning',
            )}
          >
            {error ? (
              <XCircle aria-hidden className="size-3.5 shrink-0 mt-px" />
            ) : (
              <AlertTriangle aria-hidden className="size-3.5 shrink-0 mt-px" />
            )}
            <span className="flex-1">{violation.message}</span>
            {violation.offendingGeometry !== undefined && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 px-1 -my-0.5 shrink-0"
                icon={<Crosshair aria-hidden className="size-3" />}
                onClick={() => onShowOnMap(violation.offendingGeometry as Polygon)}
              >
                Show
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
