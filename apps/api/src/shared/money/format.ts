import type { Money } from '@driverzone/contracts';

/**
 * Paise to the `Money` pair the wire format promises.
 *
 * `@driverzone/contracts` has always defined `Money { amount_paise, amount_display }` so that all
 * four clients render a figure identically — and nothing has ever produced the display half. The
 * admin panel has a `formatPaise` of its own, for values an admin is TYPING; this is for values
 * the server is REPORTING, and the two are not the same job: one round-trips through an input,
 * the other has to look right on a receipt in an app that may not share the browser's locale.
 *
 * `en-IN` grouping is not the western one — ₹10,50,000, not ₹1,050,000 — and getting that from
 * the runtime rather than by hand is the whole reason to use `Intl` here.
 */

const FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  // Fares are rounded to the rupee before they are ever displayed, so paise on a receipt would be
  // noise. A negative adjustment still formats correctly: -₹50, not ₹-50.
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatPaise(amountPaise: number): string {
  return FORMATTER.format(amountPaise / 100);
}

export function toMoney(amountPaise: number): Money {
  return { amount_paise: amountPaise, amount_display: formatPaise(amountPaise) };
}
