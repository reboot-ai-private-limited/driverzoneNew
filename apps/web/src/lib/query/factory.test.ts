import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueryFunctionContext, QueryKey } from '@tanstack/react-query';

/**
 * The two things a hand-written `useQuery` forgets, asserted so the factory cannot quietly stop
 * doing them.
 */

const withAuthMock = vi.fn();

vi.mock('../auth/session', () => ({
  withAuth: (call: (token: string) => unknown) => withAuthMock(call) as unknown,
}));

// Straight through with a token, which is the only part of `withAuth` this file is about.
withAuthMock.mockImplementation((call: (token: string) => unknown) => call('tok_test'));

const { authedQueryOptions, liveQueryOptions } = await import('./factory');
const { keepPreviousData } = await import('@tanstack/react-query');

function runQueryFn(options: ReturnType<typeof authedQueryOptions<string>>, signal: AbortSignal) {
  const context = { queryKey: options.queryKey, signal } as QueryFunctionContext<QueryKey>;
  return (options.queryFn as (c: QueryFunctionContext<QueryKey>) => Promise<string>)(context);
}

beforeEach(() => {
  withAuthMock.mockClear();
});

describe('authedQueryOptions', () => {
  it('goes through withAuth — a query that skips it renders "unauthenticated" on an expired token instead of refreshing', async () => {
    const fetch = vi.fn().mockResolvedValue('ok');
    const options = authedQueryOptions<string>({ queryKey: ['zones'], fetch });

    await runQueryFn(options, new AbortController().signal);

    expect(withAuthMock).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('tok_test', expect.any(AbortSignal));
  });

  it('forwards the abort signal, so a superseded request is actually abandoned', async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue('ok');

    await runQueryFn(authedQueryOptions<string>({ queryKey: ['zones'], fetch }), controller.signal);

    expect(fetch.mock.calls[0]?.[1]).toBe(controller.signal);
  });

  it('keeps the previous page — a filter change must never empty the table', () => {
    const options = authedQueryOptions<string>({ queryKey: ['zones'], fetch: vi.fn() });
    expect(options.placeholderData).toBe(keepPreviousData);
  });

  it('omits `enabled` entirely when unset, rather than passing undefined', () => {
    // `exactOptionalPropertyTypes` is on repo-wide, and an explicit `enabled: undefined` is a
    // type error rather than a default.
    expect('enabled' in authedQueryOptions({ queryKey: ['zones'], fetch: vi.fn() })).toBe(false);
  });
});

describe('liveQueryOptions', () => {
  it('polls on the given interval with no stale window', () => {
    const options = liveQueryOptions({
      queryKey: ['bookings'],
      fetch: vi.fn(),
      refetchIntervalMs: 5000,
    });

    expect(options.refetchInterval).toBe(5000);
    expect(options.staleTime).toBe(0);
  });
});
