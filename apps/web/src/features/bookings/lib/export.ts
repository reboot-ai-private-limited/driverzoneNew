import type { BookingDto } from '@driverzone/contracts';
import { formatDate, formatMobile, formatTime } from '@/lib/format';
import { serviceTypeLabel, statusLabel } from './status';

/**
 * Export and print, both client-side.
 *
 * WHAT IS EXPORTED IS WHAT IS ON SCREEN — the current page of the current filter, not the whole
 * result set. The list is paginated server-side, so exporting everything would mean walking every
 * page, and a button that quietly fires thirteen requests is not a button. The caller says so in
 * the filename and the toast; see `BookingsScreen`.
 */

const HEADERS = [
  'Booking ID',
  'Date',
  'Time',
  'Customer',
  'Customer mobile',
  'Driver',
  'Driver mobile',
  'Pickup',
  'Destination',
  'Trip type',
  'Status',
  'Fare',
] as const;

function row(booking: BookingDto): string[] {
  return [
    booking.reference,
    formatDate(booking.scheduled_at),
    formatTime(booking.scheduled_at),
    booking.customer?.name ?? '',
    booking.customer?.phone === null || booking.customer?.phone === undefined
      ? ''
      : formatMobile(booking.customer.phone),
    booking.driver?.name ?? '',
    booking.driver?.phone === null || booking.driver?.phone === undefined
      ? ''
      : formatMobile(booking.driver.phone),
    booking.pickup.address,
    booking.drop.address,
    serviceTypeLabel(booking.service_type),
    statusLabel(booking.status),
    // `amount_display`, not a local format: contracts preformats it "so all four clients render
    // identically", and an export that disagreed with the screen would be the one people trust.
    booking.fare.total.amount_display,
  ];
}

/**
 * RFC 4180 quoting. Addresses contain commas as a matter of course and a driver's name can
 * contain a quote; without this a single address silently shifts every later column of that row,
 * which is the kind of corruption nobody notices until the numbers have been used.
 */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * A BOM, because the target is Excel.
 *
 * Excel reads a CSV as the system's legacy codepage unless the file announces UTF-8 this way, and
 * on an Indian ops desk the first thing to break is a rupee sign or a name with a diacritic.
 */
export function toCsv(bookings: readonly BookingDto[]): string {
  const lines = [
    HEADERS.map(csvCell).join(','),
    ...bookings.map((b) => row(b).map(csvCell).join(',')),
  ];
  // Escaped rather than typed: a literal BOM in source is an invisible character, and the next
  // person to touch this line deletes it without ever seeing that it was there.
  return `\uFEFF${lines.join('\r\n')}`;
}

export function downloadCsv(bookings: readonly BookingDto[], filename: string): void {
  const blob = new Blob([toCsv(bookings)], { type: 'text/csv;charset=utf-8' });
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
 * Deliberately not a PDF library. Generating one client-side means shipping ~300 KB to lay out a
 * table the browser already lays out, and it would drift from the screen the moment a column
 * changed. The print stylesheet in `globals.css` is what makes the printed page a clean table.
 */
export function printCurrentView(): void {
  window.print();
}
