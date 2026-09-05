'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from './cn';

export interface Column<Row> {
  key: string;
  header: ReactNode;
  /** Tailwind width class. Also what the matching skeleton should use. */
  width?: string;
  align?: 'left' | 'right';
  sortable?: boolean;
  /** Money, counts, distances and ids — see design-language.md §Type and density. */
  numeric?: boolean;
  render: (row: Row) => ReactNode;
}

export interface SortState {
  key: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<Row> {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: Row) => void;
  /** Dims the body while a refetch is in flight, without removing a single row. */
  refetching?: boolean;
}

/**
 * A dense table. Hairline rules, no shadow, no zebra striping — striping doubles the visual
 * weight of a 20-row table to solve a problem that row height and a hover state already solve.
 *
 * The header is sticky, because scrolling 128 rows past a header you can no longer see is the
 * single most common complaint about an admin table.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  onRowClick,
  refetching = false,
}: DataTableProps<Row>) {
  const toggle = (key: string): void => {
    if (onSortChange === undefined) return;
    onSortChange({
      key,
      direction: sort?.key === key && sort.direction === 'asc' ? 'desc' : 'asc',
    });
  };

  return (
    // The wrapper scrolls, not the page. A wide table must never make the whole document
    // scroll horizontally — that moves the nav off screen.
    //
    // `print:overflow-visible`: browsers clip a scrollable region's overflow when printing —
    // whatever needed a horizontal scroll to reach on screen is silently absent from the page
    // rather than pushed onto a second one. `overflow-visible` lets a wide table spill and be
    // printed in full instead of quietly losing its rightmost columns.
    <div className="w-full overflow-x-auto print:overflow-visible">
      <table className="w-full border-collapse text-sm">
        {/* `print:static`: sticky positioning means nothing once printed and repeating a
            "sticky" header at a fixed screen offset on every physical page is not what anyone
            wants from a report. */}
        <thead className="sticky top-0 z-10 bg-surface-muted print:static">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={
                  sort?.key === col.key
                    ? sort.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                className={cn(
                  'h-9 px-4 text-xs font-medium text-text-subtle whitespace-nowrap',
                  'border-b border-border',
                  col.align === 'right' ? 'text-right' : 'text-left',
                  col.width,
                )}
              >
                {col.sortable === true && onSortChange !== undefined ? (
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    className={cn(
                      'inline-flex items-center gap-1 hover:text-text',
                      col.align === 'right' && 'flex-row-reverse',
                    )}
                  >
                    {col.header}
                    {sort?.key === col.key &&
                      (sort.direction === 'asc' ? (
                        <ArrowUp aria-hidden className="size-3" />
                      ) : (
                        <ArrowDown aria-hidden className="size-3" />
                      ))}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          className={cn(
            'transition-opacity',
            // Dimmed, never emptied. `keepPreviousData` holds the rows; this only says
            // "there is newer data coming".
            refetching && 'opacity-60',
          )}
        >
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
              className={cn(
                'border-b border-border',
                onRowClick !== undefined && 'cursor-pointer hover:bg-surface-muted',
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-2 align-middle',
                    col.align === 'right' ? 'text-right' : 'text-left',
                    col.numeric === true && 'tnum',
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The two-line cell: primary value in body ink, secondary beneath it in subtle ink.
 * `WB12AB1234` over `Hyundai i20`, `18 May 2025` over `10:30 AM`.
 *
 * It doubles the information per row without a second column, and it exists as a primitive so
 * it is not re-invented per table with slightly different spacing each time.
 */
export function CellStack({
  primary,
  secondary,
  numeric,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  numeric?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-0.5', numeric === true && 'tnum')}>
      <span className="text-sm text-text leading-tight">{primary}</span>
      {secondary !== undefined && (
        <span className="text-xs text-text-subtle leading-tight">{secondary}</span>
      )}
    </div>
  );
}
