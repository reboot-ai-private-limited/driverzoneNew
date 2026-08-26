'use client';

import { useEffect, useMemo, useRef } from 'react';
import { debounce, type Scheduled } from './scheduling';

/**
 * A debounced callback with a stable identity, safe to hand to an effect or a child's props.
 *
 * The ref is what makes both of those true at once: the returned function does not change when
 * `fn` does, but it still calls the CURRENT `fn` — so a handler closing over this render's state
 * does not fire with state from four keystrokes ago.
 *
 * Pending calls are cancelled on unmount. Without that, a debounced setState lands on a
 * component that no longer exists every time an admin navigates away mid-edit.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): Scheduled<A> {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  const scheduled = useMemo(
    () => debounce<A>((...args) => latest.current(...args), delayMs),
    [delayMs],
  );

  useEffect(() => scheduled.cancel, [scheduled]);

  return scheduled;
}
