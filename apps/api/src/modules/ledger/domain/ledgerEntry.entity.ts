/**
 * DOMAIN — one movement of money involving a driver.
 *
 * APPEND-ONLY AND SIGNED. There is no update and no delete: a correction is another row with the
 * opposite sign, which is what makes the history reconstructable and a dispute answerable. The
 * driver's balance is the SUM of these rows; `drivers.walletBalancePaise` is a cache of that sum
 * and never the source of truth.
 *
 * Built now rather than later on purpose. Retrofitting a ledger after ten thousand bookings means
 * reconstructing history from booking rows, and it is genuinely miserable work
 * (docs/LLD/pricing-and-commission.md §The ledger).
 */

import { TRANSACTION_TYPES, type TransactionType } from '@driverzone/contracts';

/**
 * ONE LIST, NOT TWO THAT AGREE.
 *
 * The entry types are defined in `@driverzone/contracts` and imported here, rather than declared
 * locally and pinned to the wire enum by a drift guard. A guard would catch a disagreement; this
 * makes one impossible — the Mongoose `enum`, the domain type and the admin DTO are all the same
 * array. That matters because the two lists HAD already drifted: the wire enum shipped without
 * `CASH_COLLECTED`, which is the one row a cash trip exists to write.
 *
 * The alias is kept because `LedgerEntryType` reads correctly inside this module, where a row is
 * a ledger entry rather than a "transaction".
 */
export const LEDGER_ENTRY_TYPES = TRANSACTION_TYPES;
export type LedgerEntryType = TransactionType;

/**
 * The types for which at most ONE row may exist per booking.
 *
 * This is what makes completing a trip idempotent: the `→ COMPLETED` side effects run after the
 * transaction commits, so a crash between commit and ledger write means the handler is retried,
 * and without this a driver is credited twice. Enforced by a unique partial index rather than a
 * read-then-write, because two concurrent retries would both read "no row" and both insert.
 *
 * `PENALTY` and `ADJUSTMENT` are deliberately absent — a booking can legitimately carry a late
 * fine and a cancellation penalty, and an admin may correct the same booking more than once.
 */
export const ONCE_PER_BOOKING_TYPES = [
  'TRIP_EARNING',
  'WAITING_EARNING',
  'COMMISSION_DEBIT',
  'CASH_COLLECTED',
] as const satisfies readonly LedgerEntryType[];

export interface LedgerEntry {
  id: string;
  driverId: string;
  /** Null for entries that are not about a trip — a payout, a manual adjustment, a bonus. */
  bookingId: string | null;
  entryType: LedgerEntryType;
  /** Signed, in paise. Positive is owed TO the driver; negative is owed BY them. */
  amountPaise: number;
  /** Free text for a human reading a statement. Required on ADJUSTMENT and PENALTY. */
  note: string | null;
  /** Set when the entry is included in a payout batch; null while it is outstanding. */
  payoutId: string | null;
  createdAt: Date;
}

/** What a caller supplies. `id`, `createdAt` and `payoutId` are the ledger's to assign. */
export interface NewLedgerEntry {
  driverId: string;
  bookingId?: string | null;
  entryType: LedgerEntryType;
  amountPaise: number;
  note?: string | null;
  payoutId?: string | null;
}

/**
 * The sign each entry type must carry, or `null` where either is legitimate.
 *
 * A `CASH_COLLECTED` row entered positive would flip a debt into a credit and pay a driver for
 * money they are holding. Cheap to check, and the kind of mistake that is invisible until a
 * payout run.
 */
const REQUIRED_SIGN: Record<LedgerEntryType, 'POSITIVE' | 'NEGATIVE' | null> = {
  TRIP_EARNING: 'POSITIVE',
  WAITING_EARNING: 'POSITIVE',
  COMMISSION_DEBIT: 'NEGATIVE',
  CASH_COLLECTED: 'NEGATIVE',
  PAYOUT: 'NEGATIVE',
  ADJUSTMENT: null,
  PENALTY: 'NEGATIVE',
  BONUS: 'POSITIVE',
};

/** Returns a message when the entry is malformed, or `null` when it is fine. */
export function validateEntry(entry: NewLedgerEntry): string | null {
  if (!Number.isInteger(entry.amountPaise)) {
    return `${entry.entryType} amount must be an integer number of paise`;
  }

  const sign = REQUIRED_SIGN[entry.entryType];
  if (sign === 'POSITIVE' && entry.amountPaise < 0) {
    return `${entry.entryType} must not be negative`;
  }
  if (sign === 'NEGATIVE' && entry.amountPaise > 0) {
    return `${entry.entryType} must not be positive — it is money the driver owes`;
  }

  if ((entry.entryType === 'ADJUSTMENT' || entry.entryType === 'PENALTY') && !entry.note) {
    return `${entry.entryType} requires a note explaining it`;
  }

  return null;
}
