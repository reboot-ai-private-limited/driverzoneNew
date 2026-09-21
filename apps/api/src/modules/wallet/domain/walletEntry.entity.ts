import { WALLET_ENTRY_TYPES, type WalletEntryType } from '@driverzone/contracts';

/**
 * DOMAIN — one movement of money in a customer's wallet.
 *
 * APPEND-ONLY AND SIGNED, exactly like the driver ledger next door and for the same reason: there
 * is no update and no delete, a correction is another row with the opposite sign, and the balance
 * is the SUM of the rows. `customers.walletBalancePaise` is a cache of that sum, never the truth.
 *
 * SIGN IS FROM THE CUSTOMER'S SIDE — positive means the company owes them, negative means they
 * owe the company. That is the reverse of the accounting convention and the same as how the
 * wallet screen reads, which is the direction that matters at every call site.
 *
 * WHY THIS IS NOT THE DRIVER LEDGER. The two look alike and answer different questions: the
 * driver ledger accrues earnings and settles them in payout batches, this one accrues charges and
 * settles them inside a booking's own payment. Sharing one collection would mean every read
 * carrying a "which kind of party" filter, and one wrong filter mixing a driver's earnings into a
 * customer's balance.
 */

export const CUSTOMER_WALLET_ENTRY_TYPES = WALLET_ENTRY_TYPES;
export type { WalletEntryType };

export interface WalletEntry {
  id: string;
  customerId: string;
  /** Null for entries that are not about a trip — a granted credit, a standalone fine. */
  bookingId: string | null;
  entryType: WalletEntryType;
  /** Signed, in paise. Positive is owed TO the customer; negative is owed BY them. */
  amountPaise: number;
  /** Free text for a human reading a statement. Required on FINE and ADJUSTMENT. */
  note: string | null;
  createdAt: Date;
}

/** What a caller supplies. `id` and `createdAt` are the wallet's to assign. */
export interface NewWalletEntry {
  customerId: string;
  bookingId?: string | null;
  entryType: WalletEntryType;
  amountPaise: number;
  note?: string | null;
}

/**
 * The types for which at most ONE row may exist per booking.
 *
 * This is what makes the booking side effects idempotent: they run after their transaction
 * commits and may be retried, so without this a crash between commit and wallet write charges a
 * cancellation fee twice, or spends the same credit twice. Enforced by a unique partial index
 * rather than read-then-write, because two concurrent retries would both read "no row" and both
 * insert.
 *
 * `CREDIT_GRANT`, `FINE` and `ADJUSTMENT` are deliberately absent — an admin may legitimately
 * fine the same booking twice, or correct it more than once.
 */
export const ONCE_PER_BOOKING_WALLET_TYPES = [
  'CANCELLATION_FEE',
  'SPENT_ON_RIDE',
  'DEBT_COLLECTED',
] as const satisfies readonly WalletEntryType[];

/**
 * The sign each type must carry, or `null` where either is legitimate.
 *
 * A `CANCELLATION_FEE` entered positive would turn a penalty into a gift. Cheap to check, and
 * invisible until someone reconciles a month of wallets.
 */
const REQUIRED_SIGN: Record<WalletEntryType, 'POSITIVE' | 'NEGATIVE' | null> = {
  CREDIT_GRANT: 'POSITIVE',
  CANCELLATION_FEE: 'NEGATIVE',
  FINE: 'NEGATIVE',
  SPENT_ON_RIDE: 'NEGATIVE',
  // The exact reversal of the line above, so it can only ever be positive.
  RELEASED_FROM_RIDE: 'POSITIVE',
  DEBT_COLLECTED: 'POSITIVE',
  ADJUSTMENT: null,
};

/** Returns a message when the entry is malformed, or `null` when it is fine. */
export function validateWalletEntry(entry: NewWalletEntry): string | null {
  if (!Number.isInteger(entry.amountPaise)) {
    return `${entry.entryType} amount must be an integer number of paise`;
  }
  if (entry.amountPaise === 0) {
    // A zero row is not a correction, it is noise in a statement someone has to read.
    return `${entry.entryType} amount must not be zero`;
  }

  const sign = REQUIRED_SIGN[entry.entryType];
  if (sign === 'POSITIVE' && entry.amountPaise < 0) {
    return `${entry.entryType} must not be negative — it is credit to the customer`;
  }
  if (sign === 'NEGATIVE' && entry.amountPaise > 0) {
    return `${entry.entryType} must not be positive — it is money the customer owes`;
  }

  if ((entry.entryType === 'FINE' || entry.entryType === 'ADJUSTMENT') && !entry.note) {
    return `${entry.entryType} requires a note explaining it`;
  }

  return null;
}

/**
 * How a balance meets a fare, and the one place that arithmetic lives.
 *
 * CREDIT IS CAPPED AT THE FARE. A ₹900 balance against a ₹500 trip spends ₹500 and keeps ₹400 —
 * it never pays out the difference, because a wallet is not a bank account and a trip cannot cost
 * less than nothing.
 *
 * DEBT IS ADDED IN FULL, with no cap, which is what "added to your next ride" means. It is also
 * why a customer in debt cannot pay cash: see `createBooking.usecase.ts`.
 */
export interface WalletApplication {
  /** Credit consumed by this booking. Always >= 0. */
  creditAppliedPaise: number;
  /** Debt folded into this booking's payment. Always >= 0. */
  debtAddedPaise: number;
  /** What the customer actually pays: the fare, less credit, plus debt. Never negative. */
  payablePaise: number;
}

export function applyWalletToFare(balancePaise: number, farePaise: number): WalletApplication {
  const creditAppliedPaise = balancePaise > 0 ? Math.min(balancePaise, farePaise) : 0;
  const debtAddedPaise = balancePaise < 0 ? -balancePaise : 0;

  return {
    creditAppliedPaise,
    debtAddedPaise,
    payablePaise: farePaise - creditAppliedPaise + debtAddedPaise,
  };
}
