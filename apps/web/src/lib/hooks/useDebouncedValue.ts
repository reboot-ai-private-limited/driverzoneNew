'use client';

import { useEffect, useState } from 'react';
import { debounce } from './scheduling';

/**
 * The settled form of a value that is still changing — a search box, a polygon being dragged.
 *
 * Use this to keep a fast-moving value OUT of a query key. TanStack Query already de-duplicates
 * concurrent requests for the same key, so debouncing does not save us from duplicate calls; it
 * saves us from eight *different* keys for eight keystrokes, each of which is a real request the
 * user did not ask for.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    // `() => next` rather than `next`: a T that happens to be a function would otherwise be
    // read by React as a state updater and called instead of stored.
    const schedule = debounce((next: T) => setSettled(() => next), delayMs);
    schedule(value);
    return schedule.cancel;
  }, [value, delayMs]);

  return settled;
}
