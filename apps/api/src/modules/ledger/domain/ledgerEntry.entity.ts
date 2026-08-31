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

export const LEDGER_ENTRY_TYPES = [
  /** The driver's share of a completed trip's subtotal. Positive. */
  'TRIP_EARNING',
  /**
   * Waiting time the customer was charged for, credited to the driver IN FULL with no commission
   * taken. It compensates the driver's time and the company did nothing to earn a share of it.
   * Positive, and a separate type from `TRIP_EARNING` precisely so that "how much did drivers
   * earn waiting last month" is a query rather than an archaeology exercise.
   */
  'WAITING_EARNING',
  /** Commission taken separately, for the cases where it was not already netted off. Negative. */
  'COMMISSION_DEBIT',
  /**
   * Cash the driver took from the customer. NEGATIVE: they are holding the company's money, so
   * it counts against what they are owed.
   */
  'CASH_COLLECTED',
  /** A settlement paid out to the driver. Negative — it discharges a balance owed. */
  'PAYOUT',
  /** A manual correction by an admin. Either sign, and always with a reason. */
  'ADJUSTMENT',
  /** A late fine or a cancellation penalty. Negative. */
  'PENALTY',
  /** An incentive. Positive. */
  'BONUS',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

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
