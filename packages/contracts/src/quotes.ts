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

/**
 * `GET /admin/quotes/explain` — WHICH PRODUCT A PAIR OF COORDINATES RESOLVES TO, AND WHY.
 *
 * The support tool for "this in-city tour was charged as an outstation trip". In-city outranks
 * outstation unconditionally and at any distance, so that complaint is never the precedence
 * ladder being wrong — it is one of three facts about the DATA, and all three used to produce an
 * identical, unexplained symptom:
 *
 *   - the drop fell outside the city polygon (`incity_rejected: 'NOT_SAME_CITY'`),
 *   - that city has no in-city package (`'NO_PACKAGE_FOR_CITY'`),
 *   - it has one, and every variant on it is inactive (`'NO_ACTIVE_VARIANT'`).
 *
 * ADMIN ONLY, and a GET so the URL can be pasted into a ticket. It writes nothing — no quote row
 * is created — so running it does not consume anything or change what a customer would be quoted.
 */
export interface TripResolutionPointDto {
  pickup_zone: { id: string; name: string } | null;
  city_zone: { id: string; name: string } | null;
  hill_zone: { id: string; name: string } | null;
}

export interface TripResolutionTraceDto {
  city_zone_id: string | null;
  to_same_city_zone: boolean;
  terrain: Terrain;
  distance_km: number;
  /** In-city packages found for that city zone, before the active-variant filter. */
  incity_candidates: number;
  /** Null when in-city won. */
  incity_rejected: 'NOT_SAME_CITY' | 'NO_PACKAGE_FOR_CITY' | 'NO_ACTIVE_VARIANT' | null;
  outstation_candidates: number;
  outstation_band_id: string | null;
}

export interface ExplainTripResponse {
  from: TripResolutionPointDto;
  to: TripResolutionPointDto;
  /** Null when the pickup is not served — the ladder stops before measuring anything. */
  distance_km: number | null;
  /** Null when the trip never reached the package ladder. */
  trace: TripResolutionTraceDto | null;
  verdict: {
    service_type: ServiceType | null;
    package_id: string | null;
    package_name: string | null;
    /** The customer-facing reason when nothing can be sold. Null when something can. */
    unavailable: string | null;
  };
}
