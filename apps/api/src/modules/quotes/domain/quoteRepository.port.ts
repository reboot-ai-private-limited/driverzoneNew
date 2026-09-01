import type { Quote } from './quote.entity.js';

export type NewQuote = Omit<Quote, 'id' | 'consumedBy' | 'createdAt'>;

export interface QuoteRepositoryPort {
  /** Written as one batch: every option in a fare card shares an expiry and is created together. */
  createMany(quotes: readonly NewQuote[]): Promise<Quote[]>;

  findById(id: string): Promise<Quote | null>;

  /**
   * Claims a quote for a booking, atomically, and only if it is unclaimed and unexpired.
   *
   * This one call is what stops a double-tapped Confirm producing two bookings at one price. It
   * is a compare-and-swap rather than a read-then-write because two taps arriving together would
   * both read `consumedBy: null` and both proceed.
   *
   * Returns `null` when the claim failed — which the caller must then diagnose by reading the
   * row, since "already consumed" and "expired" lead to very different answers for the customer.
   */
  consume(id: string, bookingId: string, now: Date): Promise<Quote | null>;
}
