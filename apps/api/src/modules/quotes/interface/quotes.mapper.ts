import type {
  CreateQuoteResponse,
  FareBreakdownDto,
  QuoteOptionDto,
} from '@driverzone/contracts';
import { toMoney } from '../../../shared/money/format.js';
import type { FareBreakdown } from '../../pricing/pricing.public.js';
import type { Quote } from '../domain/quote.entity.js';
import type { QuotedTrip } from '../application/useCases/createQuote.usecase.js';

/**
 * INTERFACE — domain entities to the snake_case DTOs the contracts promise.
 *
 * Every money field goes through `toMoney`, so the wire carries paise AND a rendered string. That
 * is what stops four clients each inventing their own ₹ formatting and disagreeing about where the
 * Indian grouping commas go.
 */

function toFareDto(fare: FareBreakdown): FareBreakdownDto {
  return {
    lines: fare.lines.map((line) => ({
      code: line.code,
      label: line.label,
      amount: toMoney(line.amountPaise),
    })),
    subtotal: toMoney(fare.subtotalPaise),
    tax: toMoney(fare.taxPaise),
    total: toMoney(fare.totalPaise),
  };
}

/**
 * The commission split is deliberately NOT on the wire. It is frozen on the booking and it is
 * the company's business with the driver; a customer has no use for it and an app that receives
 * it will eventually display it.
 */
function toOptionDto(quote: Quote): QuoteOptionDto {
  return {
    quote_id: quote.id,
    service_type: quote.serviceType,
    label: quote.source.variantLabel ?? (quote.fare.lines[0]?.label ?? quote.source.packageName),
    included_minutes: quote.includedMinutes,
    fare: toFareDto(quote.fare),
  };
}

export function toCreateQuoteResponse(result: QuotedTrip): CreateQuoteResponse {
  const [first] = result.quotes;

  return {
    // Every option in one fare card is created together and expires together, so a single
    // countdown on the screen is honest rather than an approximation of several.
    expires_at: (first?.expiresAt ?? new Date()).toISOString(),
    service_type: first?.serviceType ?? 'INCITY',
    distance_km: result.distanceKm,
    terrain: first?.source.terrain ?? null,
    outstation_hours_per_day: result.outstationHoursPerDay,
    options: result.quotes.map(toOptionDto),
  };
}
