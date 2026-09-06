import type {
  CustomerWalletRowDto,
  DriverBalanceRowDto,
  FinanceTransactionDto,
} from '@driverzone/contracts';
import { formatDate, formatMobile, formatTime } from '@/lib/format';

/**
 * Export and print for the three Finance tabs, both client-side.
 *
 * WHAT IS EXPORTED IS WHAT IS ON SCREEN — the current page of the current filter, not the whole
 * result set. Every one of these lists is paginated server-side, so exporting everything would
 * mean walking every page, and a button that quietly fires thirteen requests is not a button.
 * Each caller says so in the filename and the toast; see the tabs.
 *
 * This is `features/bookings/lib/export.ts` generalised. That file hard-codes one row type
 * because it only ever had one table; three tables needed the quoting and the BOM factored out,
 * and the sheet builders below are the only per-tab part. If a fourth table appears, add a
 * builder — do not add a second copy of `csvCell`.
 *
 * MONEY IS ALWAYS `amount_display`, never a locally formatted paise value. `http.ts` says the
 * display string exists "so all four clients render identically", and an export that disagreed
 * with the screen it came from would be the one people trust.
 */

/** A sheet is its header row plus its body rows — everything `toCsv` needs and nothing more. */
export interface Sheet {
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}

/**
 * RFC 4180 quoting. A driver's name can contain a comma or a quote and a settlement note can
 * contain both; without this a single note silently shifts every later column of that row, which
 * is the kind of corruption nobody notices until the numbers have been used.
 */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * A BOM, because the target is Excel.
 *
 * Excel reads a CSV as the system's legacy codepage unless the file announces UTF-8 this way, and
 * on an Indian ops desk the first thing to break is the rupee sign — which is in every money
 * column of every sheet here.
 */
export function toCsv(sheet: Sheet): string {
  const lines = [
    sheet.headers.map(csvCell).join(','),
    ...sheet.rows.map((row) => row.map(csvCell).join(',')),
  ];
  // Built from its code point rather than typed: a literal BOM in source is an invisible
  // character, and the next person to touch this line deletes it without ever seeing it was there.
  return String.fromCharCode(0xfeff) + lines.join('\r\n');
}

export function downloadCsv(sheet: Sheet, filename: string): void {
  const blob = new Blob([toCsv(sheet)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();

  // Revoked on the next tick, not immediately: the click is dispatched synchronously but the
  // browser reads the blob after this function returns, and revoking first gives an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * "Export PDF" opens the print dialog, where the browser's own "Save as PDF" does the work.
 *
 * Deliberately not a PDF library, for the reason the bookings screen gives: generating one
 * client-side means shipping ~300 KB to lay out a table the browser already lays out, and it
 * would drift from the screen the moment a column changed.
 */
export function printCurrentView(): void {
  window.print();
}

/** A phone that may be absent. The tabs render a dash; a spreadsheet cell wants to be empty. */
function phone(value: string | null): string {
  return value === null ? '' : formatMobile(value);
}

/** A timestamp that may be absent — `last_entry_at` is null for a row with no activity yet. */
function stamp(value: string | null): string {
  return value === null ? '' : `${formatDate(value)} ${formatTime(value)}`;
}

export function driverBalancesSheet(rows: readonly DriverBalanceRowDto[]): Sheet {
  return {
    headers: [
      'Driver',
      'Mobile',
      'Balance',
      'Owed to company',
      'Payable to driver',
      'Lifetime earnings',
      'Entries',
      'Last entry',
      'Status',
    ],
    rows: rows.map((row) => [
      row.name ?? '',
      phone(row.phone),
      row.balance.amount_display,
      row.owed_to_company.amount_display,
      row.payable_to_driver.amount_display,
      row.lifetime_earnings.amount_display,
      String(row.entry_count),
      stamp(row.last_entry_at),
      // The suspension flag is the reason someone exports this sheet at all, so it is a column
      // rather than a styling detail that dies on the way out of the browser.
      row.is_suspended_for_balance ? 'Suspended' : 'Active',
    ]),
  };
}

export function transactionsSheet(rows: readonly FinanceTransactionDto[]): Sheet {
  return {
    headers: [
      'Date',
      'Time',
      'Account type',
      'Account',
      'Type',
      'Amount',
      'Direction',
      'Booking',
      'Note',
    ],
    rows: rows.map((row) => [
      formatDate(row.created_at),
      formatTime(row.created_at),
      row.party.kind === 'DRIVER' ? 'Driver' : 'Customer',
      row.party.name ?? '',
      row.type_label,
      row.amount.amount_display,
      /*
       * `direction`, not the sign of the amount. The two ledgers write their signs from opposite
       * sides, so a spreadsheet that carried only the amount would let someone SUM a column that
       * mixes money coming in with money going out — the exact failure the on-screen Direction
       * column exists to prevent, and worse on paper because there is no tooltip to correct it.
       */
      row.direction === 'NEUTRAL' ? '' : row.direction === 'IN' ? 'In' : 'Out',
      row.booking_id ?? '',
      row.note ?? '',
    ]),
  };
}

export function customerWalletsSheet(rows: readonly CustomerWalletRowDto[]): Sheet {
  return {
    headers: [
      'Customer',
      'Mobile',
      'Balance',
      'Spendable credit',
      'Owes us',
      'Entries',
      'Last entry',
    ],
    rows: rows.map((row) => [
      row.name ?? '',
      phone(row.phone),
      row.balance.amount_display,
      row.spendable_credit.amount_display,
      row.amount_owed.amount_display,
      String(row.entry_count),
      stamp(row.last_entry_at),
    ]),
  };
}
