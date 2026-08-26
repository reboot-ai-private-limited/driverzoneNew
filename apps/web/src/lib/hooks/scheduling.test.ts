import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce, throttle } from './scheduling';

/**
 * The timing primitives, tested where the bugs actually are: the trailing call that never fires,
 * and the pending call that survives a cancel.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  it('runs once, after the last call, with the last arguments', () => {
    const fn = vi.fn();
    const schedule = debounce(fn, 250);

    schedule('z');
    vi.advanceTimersByTime(200);
    schedule('zo');
    vi.advanceTimersByTime(200);
    schedule('zon');

    // 400ms of typing has produced nothing yet — which is the entire point.
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('zon');
  });

  it('drops a pending call on cancel — this is what unmount relies on', () => {
    const fn = vi.fn();
    const schedule = debounce(fn, 250);

    schedule('zone');
    schedule.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).not.toHaveBeenCalled();
  });
});

describe('throttle', () => {
  it('runs immediately on the first call', () => {
    const fn = vi.fn();
    throttle(fn, 100)(1);
    expect(fn).toHaveBeenCalledWith(1);
  });

  it('collapses a burst to the leading call and one trailing call', () => {
    const fn = vi.fn();
    const schedule = throttle(fn, 100);

    schedule(1);
    vi.advanceTimersByTime(10);
    schedule(2);
    vi.advanceTimersByTime(10);
    schedule(3);

    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);

    // The trailing run carries 3, not 2. A gesture that ends mid-window must leave the screen
    // showing where the pointer FINISHED, not an intermediate position it passed through.
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(3);
  });

  it('drops the trailing call on cancel', () => {
    const fn = vi.fn();
    const schedule = throttle(fn, 100);

    schedule(1);
    schedule(2);
    schedule.cancel();
    vi.advanceTimersByTime(1000);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1);
  });
});
