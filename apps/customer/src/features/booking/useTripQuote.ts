import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CreateQuoteResponse, Direction, UnavailableResult } from '@driverzone/contracts';
import { createQuote, isUnavailable, type CreateQuoteResult } from '@/lib/api/endpoints/quotes';
import { keys } from '@/lib/query/keys';

/**
 * The trip's price, asked once and read wherever the answer is needed.
 *
 * Home calls this to know whether Continue can be pressed at all — only `POST /quotes` can say
 * "no package covers this distance", since `/coverage/check` resolves zones and knows nothing
 * about packages — and `FareSheet` then renders the very same object rather than asking again.
 *
 * SO THE FARE SHEET NEVER FETCHES. It receives a `TripQuote` as a prop. That is what makes
 * Continue instant: the price is already in hand when the sheet rises, and the countdown the
 * customer sees is the one that has been running since the quote was made, not a fresh one
 * started by opening a sheet.
 */

/** Quoting is rate limited to 30/min per customer and writes a row per option, so: no drive-by
 * refetches. A re-quote is always something the customer did — the countdown lapsing, switching
 * direction, or asking for a new price — never a window regaining focus. */
const QUERY_OPTIONS = {
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  /**
   * Every trip option is a NEW KEY — switching one-way ⇄ round trip, moving the pickup time — so
   * without this the sheet and the home block would blank to a spinner on each change. Keeping
   * the previous answer on screen while the new one loads makes it a price that updates rather
   * than a screen that reloads.
   *
   * Callers MUST check `stale` before treating the result as an answer about the CURRENT inputs:
   * while it is true, what is being shown belongs to the previous trip, direction or time. Home
   * does exactly that before rendering its no-package notice, which would otherwise flash the old
   * destination's verdict over a new one, and the fare sheet dims the list on it.
   */
  placeholderData: keepPreviousData,
} as const;

export interface TripQuote {
  query: UseQueryResult<CreateQuoteResult, Error>;
  /** The fare card, or null when the answer was `available: false` or nothing has arrived. */
  card: CreateQuoteResponse | null;
  /** The `available: false` answer, or null. A 200, never an error — see `isUnavailable`. */
  unavailable: UnavailableResult | null;
  /** True while the value above describes the PREVIOUS inputs rather than the current ones. */
  stale: boolean;
}

export interface QuotePoint {
  lat: number;
  lng: number;
}

/**
 * `enabled` is the caller's own precondition, ANDed with "we have two points". Home passes the
 * coverage verdict through it so no quote is attempted for a pickup we already know we do not
 * serve — that answer is on screen before this hook would run, and asking anyway would spend a
 * request to be told something the customer has already read.
 *
 * `direction` applies to OUTSTATION ONLY and the server ignores it for incity, so a caller that
 * does not yet know which product this trip is can simply leave it alone.
 */
export function useTripQuote(
  pickup: QuotePoint | null,
  drop: QuotePoint | null,
  enabled = true,
  direction: Direction = 'ONE_WAY',
  /**
   * The pickup instant, or `null` for "now" — which is sent as an ABSENT field, never as this
   * device's clock reading. The server substitutes its own time, so a phone running slow cannot
   * book into the past. Keyed by its ISO string so moving the time re-quotes: it decides which
   * surcharge window the trip falls in, and is therefore part of the price.
   */
  scheduledAt: Date | null = null,
  /**
   * The return instant for an outstation round trip, or null.
   *
   * A PRICE INPUT, not a note. The band fare is a day rate and the server multiplies it by the
   * IST calendar days this spans — which is why it is in the query key below. This used to be
   * held on the screen and never sent — see the note where `RETURN_IS_LOCAL_ONLY` used to be — so
   * a customer could pick a return three days out and be quoted a same-day price.
   */
  returnAt: Date | null = null,
): TripQuote {
  /*
   * ONE_WAY IS SENT AS ABSENCE, AND BOTH HALVES OF THAT MATTER.
   *
   * `ONE_WAY` is already the server's default when `direction` is omitted, so omitting it and
   * sending it produce the same quote. Keying it as `null` is what lets home — which quotes
   * before anyone knows whether this trip is even outstation, and so never names a direction —
   * share its cache entry with a fare screen sitting on the one-way tab. Send the string here and
   * the two keys differ by a word, every arrival on the fare screen re-quotes, and the countdown
   * the customer was watching restarts for no visible reason.
   */
  const isDefaultDirection = direction === 'ONE_WAY';
  const scheduledIso = scheduledAt === null ? null : scheduledAt.toISOString();
  // Only a round trip has a return leg; sending one on a one-way would be ignored anyway, and
  // keeping it out of the key stops the two tabs from having separate cache entries for it.
  const returnIso = direction === 'ROUND_TRIP' && returnAt !== null ? returnAt.toISOString() : null;

  const query = useQuery({
    queryKey: keys.quotes.forTrip(
      [round(pickup?.lat ?? 0), round(pickup?.lng ?? 0)],
      [round(drop?.lat ?? 0), round(drop?.lng ?? 0)],
      isDefaultDirection ? null : direction,
      scheduledIso,
      returnIso,
    ),
    queryFn: () => {
      if (pickup === null || drop === null) {
        return Promise.reject(new Error('This trip is missing a pickup or a destination.'));
      }
      return createQuote({
        pickup: { lat: pickup.lat, lng: pickup.lng },
        drop: { lat: drop.lat, lng: drop.lng },
        ...(isDefaultDirection ? {} : { direction }),
        ...(scheduledIso === null ? {} : { scheduledAt: scheduledIso }),
        ...(returnIso === null ? {} : { returnAt: returnIso }),
        // THE INSURANCE FEATURE IS WITHDRAWN from the customer app, so every quote is priced
        // without the line. Sent explicitly rather than omitted, because the server's default is
        // the opposite — omit it and the trip is quoted WITH insurance the customer can no longer
        // see or decline. The endpoint still supports it, so bringing the choice back is a matter
        // of restoring the control, not the API.
        insurance: false,
      });
    },
    enabled: enabled && pickup !== null && drop !== null,
    ...QUERY_OPTIONS,
  });

  const answer = query.data;

  return {
    query,
    card: answer === undefined || isUnavailable(answer) ? null : answer,
    unavailable: answer !== undefined && isUnavailable(answer) ? answer : null,
    stale: query.isPlaceholderData,
  };
}

/**
 * Five decimals is about a metre — the same rounding the coverage key uses, for the same reason:
 * a float differing in its fifteenth decimal is the same street corner, and an unrounded key
 * would miss the cache and re-ask on every render that recreates the point.
 */
function round(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}
