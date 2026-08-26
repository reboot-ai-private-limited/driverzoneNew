'use client';

import { useEffect, useMemo, useRef } from 'react';
import { throttle, type Scheduled } from './scheduling';

/**
 * A throttled callback with a stable identity — same construction as `useDebouncedCallback`, and
 * for the same reasons.
 *
 * Reach for this when the handler must keep running DURING a continuous gesture: map pan, drag,
 * resize. Debouncing those means nothing happens until the user stops moving, which for a map is
 * indistinguishable from being frozen.
 */
export function useThrottledCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): Scheduled<A> {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  const scheduled = useMemo(
    () => throttle<A>((...args) => latest.current(...args), intervalMs),
    [intervalMs],
  );

  useEffect(() => scheduled.cancel, [scheduled]);

  return scheduled;
}
