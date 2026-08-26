import { describe, expect, it, vi } from 'vitest';

/**
 * The property in this file is the one that silently costs money.
 *
 * `withAuth` refreshes and replays once when the access token has expired. If the idempotency
 * key were generated inside the closure it replays, one click would reach the server as two
 * unrelated requests — and `Idempotency-Key` exists precisely so that cannot happen. The failure
 * is invisible in every ordinary test, because the replay only occurs on an expired token.
 */

/** Stands in for the session layer's refresh-and-replay: runs the same closure a second time. */
const withAuthReplaying = vi.fn(async (call: (token: string) => Promise<unknown>) => {
  await call('tok_expired');
  return call('tok_fresh');
});

vi.mock('../auth/session', () => ({
  withAuth: (call: (token: string) => Promise<unknown>) => withAuthReplaying(call),
}));

const { buildMutationFn } = await import('./mutation');

describe('buildMutationFn', () => {
  it('sends the SAME idempotency key on the replay after a token refresh', async () => {
    const keys: string[] = [];

    await buildMutationFn<void, void>(async (_token, _vars, idempotencyKey) => {
      keys.push(idempotencyKey);
    })();

    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('gives a second invocation a different key — one click, one key, not one session, one key', async () => {
    const keys: string[] = [];
    const run = buildMutationFn<void, void>(async (_token, _vars, key) => {
      keys.push(key);
    });

    await run();
    await run();

    expect(new Set(keys).size).toBe(2);
  });

  it('passes the caller variables through untouched', async () => {
    const call = vi.fn().mockResolvedValue(undefined);
    await buildMutationFn<{ id: string }, void>(call)({ id: 'zone_1' });

    expect(call).toHaveBeenCalledWith('tok_expired', { id: 'zone_1' }, expect.any(String));
  });
});
