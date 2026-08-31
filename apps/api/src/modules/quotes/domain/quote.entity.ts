import type { Direction, ServiceType, Terrain } from '@driverzone/contracts';
import type { FareBreakdown } from '../../pricing/pricing.public.js';

/**
 * DOMAIN — a price we have promised to honour, for ten minutes.
 *
 * A quote is a real row and not a signed token, and that is a deliberate cost. A token would need
 * no storage, but "was this quote already used" is a question a token cannot answer, and it is
 * the question that stops one price becoming two bookings.
 *
 * SINGLE CONSUMPTION. `consumedBy` is set exactly once, by a compare-and-swap, and the booking
 * that set it is the one that owns this price. A double-tapped Confirm therefore returns the
 * first booking rather than creating a second.
 */

export interface QuoteSource {
  packageId: string;
  packageName: string;
  /** Incity only — the variant the customer picked a duration from. */
  variantId: string | null;
  variantLabel: string | null;
  pickupZoneId: string;
  pickupZoneName: string;
  cityZoneId: string | null;
  cityName: string | null;
  terrain: Terrain | null;
}

export interface Quote {
  id: string;
  customerId: string;
  serviceType: ServiceType;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  scheduledAt: Date;
  direction: Direction | null;
  /** Outstation only. The ONE-WAY road distance the band was matched on. */
  distanceKm: number | null;
  includedMinutes: number | null;
  source: QuoteSource;
  /** The frozen arithmetic. Copied verbatim into the booking's fare snapshot on consumption. */
  fare: FareBreakdown;
  expiresAt: Date;
  /** The booking that claimed this quote, or null while it is still unclaimed. */
  consumedBy: string | null;
  createdAt: Date;
}

/** How long a quoted price is honoured. Long enough to read a fare card, short enough to be a price. */
export const QUOTE_TTL_MS = 10 * 60 * 1000;

export function isExpired(quote: Quote, now: Date): boolean {
  return quote.expiresAt.getTime() <= now.getTime();
}
