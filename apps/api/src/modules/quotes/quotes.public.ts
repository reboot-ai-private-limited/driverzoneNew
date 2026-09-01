import type { Quote } from './domain/quote.entity.js';

/**
 * PUBLIC CONTRACT — the only surface other modules may import from `quotes`.
 *
 * `bookings` is the consumer, and it needs exactly one thing: to turn a quote id into a frozen
 * fare, once. Everything else about quoting is reachable over HTTP and nowhere else.
 *
 * NOTE WHAT IS NOT HERE. There is no `create`, so no module can mint itself a price, and no
 * `expire`, so nothing can retire a quote a customer is still looking at. The narrowness is the
 * guarantee.
 */

/** Why a claim failed. The two cases lead to very different answers for the customer. */
export type ConsumeFailure =
  | { claimed: false; reason: 'NOT_FOUND' }
  | { claimed: false; reason: 'EXPIRED' }
  /** Somebody already booked this quote — carries the booking so a retry can return it. */
  | { claimed: false; reason: 'ALREADY_CONSUMED'; bookingId: string };

export type ConsumeResult = { claimed: true; quote: Quote } | ConsumeFailure;

export interface QuoteConsumptionContract {
  /**
   * Claims a quote for a booking, atomically. At most one booking can ever win.
   *
   * On `EXPIRED` the caller should re-quote and show the customer a price diff — "₹1,050 became
   * ₹1,100" — rather than an error. Most of the time nothing has changed and it can proceed
   * silently.
   */
  consume(quoteId: string, bookingId: string): Promise<ConsumeResult>;

  findById(quoteId: string): Promise<Quote | null>;
}

export type QuotesPublicContract = QuoteConsumptionContract;

export type { Quote, QuoteSource } from './domain/quote.entity.js';
export { QUOTE_TTL_MS, isExpired } from './domain/quote.entity.js';
