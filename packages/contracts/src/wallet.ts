import type { Money } from './http.js';

/**
 * The CUSTOMER's wallet — coupon credit they hold, and charges they owe.
 *
 * ONE SIGNED BALANCE, NOT TWO BUCKETS. Credit and debt are rows in the same ledger and net
 * against each other, so a ₹50 credit does cancel a ₹50 fine. That is a deliberate choice
 * (2026-09-02): it keeps one number on the screen and one number in the booking maths, at the
 * cost of a granted credit being able to absorb a penalty. If penalties ever need to be
 * un-absorbable, they become a second balance here rather than a flag on these rows.
 *
 * MIRRORS THE DRIVER LEDGER (`TRANSACTION_TYPES`, docs/LLD/pricing-and-commission.md §The
 * ledger) and for the same reasons: append-only, signed, no update and no delete, balance is the
 * SUM of the rows. A correction is another row. `customers.walletBalancePaise` is a cache of that
 * sum and is never the source of truth.
 *
 * SIGN CONVENTION, from the CUSTOMER's side: positive means the company owes them (spendable
 * credit), negative means they owe the company. It is the opposite way round from how an
 * accountant would write it and the same way round as how the customer reads it, which is what
 * the screen showing it needs.
 */
export const WALLET_ENTRY_TYPES = [
  /** Credit granted by an admin — a coupon, a goodwill gesture, a refund made as credit. */
  'CREDIT_GRANT',
  /** A cancellation fee the customer was charged and has not yet paid. */
  'CANCELLATION_FEE',
  /** Any other penalty an admin imposes. Requires a note. */
  'FINE',
  /** Credit consumed by a booking, reducing what that trip cost. */
  'SPENT_ON_RIDE',
  /** A debt collected as part of a booking's payment, bringing the balance back toward zero. */
  'DEBT_COLLECTED',
  /** An admin correction, either direction. Requires a note. */
  'ADJUSTMENT',
] as const;

export type WalletEntryType = (typeof WALLET_ENTRY_TYPES)[number];

export const WALLET_ENTRY_LABELS: Record<WalletEntryType, string> = {
  CREDIT_GRANT: 'Credit added',
  CANCELLATION_FEE: 'Cancellation fee',
  FINE: 'Fine',
  SPENT_ON_RIDE: 'Used on a trip',
  DEBT_COLLECTED: 'Outstanding amount paid',
  ADJUSTMENT: 'Adjustment',
};

export interface WalletEntryDto {
  id: string;
  entry_type: WalletEntryType;
  /** Signed. Positive is credit to the customer, negative is owed by them. */
  amount: Money;
  /**
   * The booking this row is about, where there is one — enough to link a statement row to a trip.
   *
   * NO `booking_reference` BESIDE IT. `wallet` sits below `bookings` in the module graph and
   * cannot read a booking to resolve one; the writer puts the human-readable `DZ-…` into `note`
   * instead, which is where a person reading a statement looks anyway.
   */
  booking_id: string | null;
  note: string | null;
  created_at: string;
}

export interface CustomerWalletDto {
  /** Signed: positive is spendable credit, negative is owed. Summed from the entries. */
  balance: Money;
  /**
   * What is spendable right now — `balance` when positive, zero when not.
   *
   * Sent rather than derived on each client so that four apps cannot disagree about whether a
   * negative balance counts as zero credit or as negative credit.
   */
  spendable_credit: Money;
  /** What the customer owes: the balance when negative, as a positive figure. Zero otherwise. */
  amount_owed: Money;
  entries: WalletEntryDto[];
}

/**
 * `POST /admin/customers/:id/wallet` — the only way credit enters a customer's wallet.
 *
 * A SIGNED AMOUNT, one endpoint for both directions, because granting ₹100 and fining ₹100 are
 * the same operation with the same audit requirements and splitting them into two endpoints
 * would mean two places to get the sign wrong.
 */
export interface GrantWalletCreditRequest {
  entry_type: Extract<WalletEntryType, 'CREDIT_GRANT' | 'FINE' | 'ADJUSTMENT'>;
  /** Signed paise. The server rejects a sign that contradicts `entry_type`. */
  amount_paise: number;
  /** Why. Mandatory — an unexplained movement of someone's money is unanswerable later. */
  note: string;
}
