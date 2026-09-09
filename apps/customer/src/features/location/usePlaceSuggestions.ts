import { useEffect, useRef, useState } from 'react';
import {
  MIN_QUERY_LENGTH,
  type PlaceSuggestion,
  newSessionToken,
  resolveSuggestion,
  suggestPlaces,
} from './placeSearch';
import { type TripPoint } from '@/features/booking/tripPoint';

/** Long enough that a typist does not pay for every letter, short enough to feel instant. */
const DEBOUNCE_MS = 250;

export interface PlaceSuggestionsState {
  suggestions: PlaceSuggestion[];
  /** A request is in flight. Distinct from "no results" — the row list is empty in both. */
  loading: boolean;
  /** A settled query that matched nothing, for the "no places found" line. */
  empty: boolean;
  /** Tap handler: resolves the row to a coordinate and closes the billing session. */
  select: (suggestion: PlaceSuggestion) => Promise<TripPoint | null>;
  /** Call after a selection or a dismissal — clears rows and starts a fresh billing session. */
  reset: () => void;
}

/**
 * Debounced type-ahead over `placeSearch`, with the two guards that keep a search box honest.
 *
 * **STALE RESPONSES.** Autocomplete responses do not arrive in the order they were sent. Without
 * a sequence check, a slow reply to "sil" can land after a fast reply to "siliguri jun" and
 * repopulate the list with results for a query the customer has already typed past. Every request
 * carries a monotonic id and only the newest one is allowed to write state — the same reason the
 * in-flight request is also aborted.
 *
 * **THE BILLING SESSION.** One token spans the whole search: every keystroke's autocomplete plus
 * the single Details call that resolves the chosen place. `reset()` rolls it, so the next search
 * is a new session rather than an ever-growing one.
 */
export function usePlaceSuggestions(
  query: string,
  near: { lat: number; lng: number } | null,
): PlaceSuggestionsState {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  const sessionToken = useRef(newSessionToken());
  const requestId = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  // Read through a ref so a map pan does not re-run the search: biasing is a nicety, and
  // re-querying on every camera frame would be a request storm.
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      inFlight.current?.abort();
      inFlight.current = null;
      requestId.current += 1; // Invalidate anything still in flight.
      setSuggestions([]);
      setLoading(false);
      setEmpty(false);
      return;
    }

    setLoading(true);
    setEmpty(false);

    const timer = setTimeout(() => {
      inFlight.current?.abort();
      const controller = new AbortController();
      inFlight.current = controller;

      requestId.current += 1;
      const id = requestId.current;

      void suggestPlaces(trimmed, {
        near: nearRef.current ?? undefined,
        sessionToken: sessionToken.current,
        signal: controller.signal,
      }).then((found) => {
        // A response for a query the customer has moved on from. Dropping it is the whole point
        // of the counter — writing it would show results for text no longer on screen.
        if (id !== requestId.current) return;
        setSuggestions(found);
        setLoading(false);
        setEmpty(found.length === 0);
      });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  // Unmount: drop the in-flight request rather than let it resolve into a dead component.
  useEffect(() => {
    return () => {
      inFlight.current?.abort();
    };
  }, []);

  return {
    suggestions,
    loading,
    empty,
    select: async (suggestion) => resolveSuggestion(suggestion, sessionToken.current),
    reset: () => {
      inFlight.current?.abort();
      inFlight.current = null;
      requestId.current += 1;
      sessionToken.current = newSessionToken();
      setSuggestions([]);
      setLoading(false);
      setEmpty(false);
    },
  };
}
