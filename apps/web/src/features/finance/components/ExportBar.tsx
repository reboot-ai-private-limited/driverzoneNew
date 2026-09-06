'use client';

import { FileSpreadsheet, Printer } from 'lucide-react';
import { Button, toast } from '@driverzone/design-system';
import { formatDate, formatTime } from '@/lib/format';
import { downloadCsv, printCurrentView, type Sheet } from '../lib/export';

/**
 * The export toolbar and the printed report's own header, for all three Finance tabs.
 *
 * One component rather than the three copies `BookingsScreen` would have implied, because the
 * printed header is the part that gets copied wrong: it exists so a sheet of paper handed to
 * another person states its own subject, its own filters and the moment it was produced instead
 * of assuming the reader was looking at the screen a second ago. Three hand-rolled versions of
 * that drift, and the one that drifts is the one that goes in front of an auditor.
 */

interface ExportBarProps {
  /** What this table is, on screen and on paper — "Driver balances", "Transactions". */
  title: string;
  /** Human-readable filter lines, already resolved by the caller. Empty means unfiltered. */
  filterSummary: readonly string[];
  /** Built lazily — a sheet is only worth constructing when somebody actually clicks. */
  sheet: () => Sheet;
  /** For the filename and both counts. `total` is the whole filtered set, `count` this page. */
  count: number;
  total: number;
  page: number;
  pageCount: number;
  /** Kebab-case, used in the CSV filename: `driver-balances-page-2-2026-09-06.csv`. */
  slug: string;
  /** What one row is called, for the toast and the printed line — "drivers", "movements". */
  noun: string;
}

export function ExportBar({
  title,
  filterSummary,
  sheet,
  count,
  total,
  page,
  pageCount,
  slug,
  noun,
}: ExportBarProps) {
  function exportExcel() {
    if (count === 0) return;
    downloadCsv(sheet(), `${slug}-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`);
    /*
     * Says the page, not the filter. What left the building was twenty rows, and an admin who
     * believes they exported 128 will reconcile against the wrong number for an hour — the same
     * reasoning `BookingsScreen` records, and it matters more here because these are balances
     * somebody is about to settle cash against.
     */
    toast.success(`Exported ${count} ${noun} from page ${page}`);
  }

  const now = new Date().toISOString();

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 print:hidden">
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={exportExcel} disabled={count === 0}>
            <FileSpreadsheet aria-hidden className="size-4" />
            Export Excel
          </Button>
          <Button size="sm" variant="ghost" onClick={printCurrentView} disabled={count === 0}>
            <Printer aria-hidden className="size-4" />
            Export PDF
          </Button>
        </div>
      </div>

      {/* PRINT ONLY — `hidden print:block`. See the note above for why the sheet re-states itself. */}
      <div className="hidden px-4 py-3 print:block">
        <h1 className="text-lg font-semibold">Finance — {title}</h1>
        {filterSummary.length > 0 && (
          <p className="mt-1 text-sm text-text-subtle">Filters — {filterSummary.join(' · ')}</p>
        )}
        <p className="mt-1 text-xs text-text-subtle">
          Showing {count} of {total} {noun} (page {page} of {pageCount}) · Generated{' '}
          {formatDate(now)}, {formatTime(now)} IST
        </p>
      </div>
    </>
  );
}
