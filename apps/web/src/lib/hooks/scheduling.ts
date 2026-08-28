/**
 * Debounce and throttle, with no React in them.
 *
 * Deliberately plain functions: this is where the timer bugs live — the trailing call that never
 * fires, the pending call that runs after unmount and sets state on a dead component — and
 * `vitest.config.ts` runs in `node`, where a plain function can be tested against fake timers
 * and a hook cannot. The hooks in this directory are thin wrappers that own only the lifecycle.
 */

export interface Scheduled<A extends unknown[]> {
  (...args: A): void;
  /** Drop anything pending. Called on unmount, and by a caller that has changed its mind. */
  cancel: () => void;
}

/**
 * Trailing-edge debounce: runs `fn` once, `delayMs` after the last call, with the last arguments.
 *
 * Trailing rather than leading because every caller here is reacting to input the user is still
 * producing — a search box, a polygon being dragged. Acting on the first keystroke means acting
 * on a one-letter query.
 */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): Scheduled<A> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduled = (...args: A): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };

  scheduled.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  return scheduled;
}

/**
 * Leading-edge throttle: runs `fn` immediately, then at most once per `intervalMs`, and always
 * once more at the end with the final arguments.
 *
 * That last clause is the part worth having. A pan handler that only ran on the leading edge
 * would leave the map showing the position from up to `intervalMs` ago once the user let go —
 * the gesture ends and the screen is subtly wrong, permanently.
 */
export function throttle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): Scheduled<A> {
  let lastRun = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const run = (args: A): void => {
    lastRun = Date.now();
    pending = null;
    fn(...args);
  };

  const scheduled = (...args: A): void => {
    const elapsed = Date.now() - lastRun;

    if (elapsed >= intervalMs && timer === null) {
      run(args);
      return;
    }

    // Inside the window: remember the newest arguments and make sure a trailing run is booked.
    // Only the newest survive — an intermediate pointer position is of no interest once a later
    // one exists.
    pending = args;
    if (timer !== null) return;

    timer = setTimeout(
      () => {
        timer = null;
        if (pending !== null) run(pending);
      },
      Math.max(0, intervalMs - elapsed),
    );
  };

  scheduled.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };

  return scheduled;
}
