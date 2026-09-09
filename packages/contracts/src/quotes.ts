import type { LatLngDto, Money } from './http.js';
import type { Direction, Terrain } from './packages.js';
import type { ServiceType } from './bookings.js';

/**
 * Quotes — asking what a trip costs.
 *
 * THE CLIENT NEVER SENDS A PRICE. It sends two points and a time, gets back a `quote_id`, and
 * hands that id to `POST /bookings`. A fare that arrives from a device is a fare a device can
 * edit.
 *
 * The response supersedes the shape in docs/LLD/api-contracts.md, which still describes an
 * `included_km` and an `overage` block of rates. Overage was deleted on 2026-08-28: the quoted
 * total IS the total, and a 3-hour rental that runs 3h 40m costs what the customer was told.
 */

export interface CreateQuoteRequest {
  pickup: LatLngDto;
  drop: LatLngDto;
  /** ISO 8601. Omit for "now" — the server decides, so a device with a wrong clock cannot book into the past. */
  scheduledAt?: string | undefined;
  /** Outstation only, ignored for incity. Defaults to ONE_WAY. */
  direction?: Direction | undefined;
  /**
   * ISO 8601. When the customer comes back — OUTSTATION ROUND TRIPS ONLY, ignored everywhere else.
   *
   * THE BAND FARE IS A DAY RATE, so this is a price input rather than a note. The server counts
   * IST calendar days from `scheduledAt` to here, both ends included, and multiplies. Omit it, or
   * return the same day, and the fare is the single-day one every quote produced before this
   * field existed.
   *
   * Must be after `scheduledAt`. There is a ceiling on the span — `outstation.max_trip_days` — and
   * a quote past it is refused rather than clamped, because clamping would charge for fewer days
   * than the driver is actually away.
   */
  returnAt?: string | undefined;
  /**
   * Whether the INSURANCE line is priced into this trip. Omit for `true` — the charge stays on
   * by default, matching every quote before this field existed; pass `false` to opt out. Applies
   * to both incity and outstation, and every option in the resulting fare card agrees, since one
   * request prices one trip and the toggle is a property of the trip, not the option.
   */
  insurance?: boolean | undefined;
}

/** One line on the fare card. `code` is stable; `label` is prose and may be rewritten. */
export interface FareLineDto {
  code: string;
  label: string;
  amount: Money;
}

export interface FareBreakdownDto {
  lines: FareLineDto[];
  subtotal: Money;
  tax: Money;
  total: Money;
}

/**
 * One buyable option. Incity returns several — one per duration on offer — and outstation
 * returns exactly one, because the direction was chosen in the request.
 */
export interface QuoteOptionDto {
  quote_id: string;
  service_type: ServiceType;
  /** '3 Hours' for incity; 'PKG-3 — One way' for outstation. Display-ready. */
  label: string;
  /** Incity only: what the customer is buying. Null for outstation. */
  included_minutes: number | null;
  fare: FareBreakdownDto;
}

export interface CreateQuoteResponse {
  /** ISO 8601. Every option in this response expires together. */
  expires_at: string;
  service_type: ServiceType;
  /** Outstation only. The one-way road distance the band was matched on. */
  distance_km: number | null;
  /** Outstation only. */
  terrain: Terrain | null;
  /**
   * Policy text with no fare consequence, shown on the fare card so both sides see what they are
   * agreeing to. Null for incity.
   */
  outstation_hours_per_day: number | null;
  options: QuoteOptionDto[];
}
