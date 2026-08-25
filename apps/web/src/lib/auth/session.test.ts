import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpErrorBody } from '@driverzone/contracts';

/**
 * The session layer, and specifically the property that a wrong implementation loses silently.
 *
 * Refresh tokens rotate, and the API treats a replayed one as theft — verified against the
 * running server, which answers `SESSION_REVOKED`. So six queries that each fire their own
 * refresh sign the admin out. Only one of these tests would fail on that bug, and it is this
 * file's reason to exist.
 */

const refreshMock = vi.fn();
const logoutMock = vi.fn();
const verifyMock = vi.fn();

vi.mock('../api/endpoints/auth', () => ({
  authApi: {
    refresh: (...args: unknown[]) => refreshMock(...args) as unknown,
    logout: (...args: unknown[]) => logoutMock(...args) as unknown,
    verifyOtp: (...args: unknown[]) => verifyMock(...args) as unknown,
  },
}));

/**
 * A fresh module registry per test — the access token and the in-flight promise are module
 * state by design, and a test that inherited them from the previous one would pass for the
 * wrong reason.
 *
 * `ApiError` comes back from the SAME registry, which is not incidental: `resetModules` gives
 * `session.ts` a new copy of the class, and an `ApiError` built from the test file's original
 * copy fails every `instanceof` inside it. The symptom is `restore()` rethrowing a 401 it
 * should have swallowed — which is the bug this file exists to catch, arriving from the test
 * harness instead of the code.
 */
async function loadSession() {
  vi.resetModules();
  const [session, errors] = await Promise.all([import('./session'), import('../api/ApiError')]);

  const httpError = (status: number, code: string): Error =>
    new errors.ApiError({
      success: false,
      statusCode: status,
      code,
      message: 'Please sign in again.',
      request: { method: 'POST', url: '/admin/auth/refresh', requestId: 'req_test' },
    } as HttpErrorBody);

  return { ...session, ApiError: errors.ApiError, httpError };
}

beforeEach(() => {
  vi.useFakeTimers();
  refreshMock.mockReset();
  logoutMock.mockReset();
  verifyMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('single-flight refresh', () => {
  it('shares one refresh across concurrent callers', async () => {
    const session = await loadSession();
    let release: (value: { access_token: string }) => void = () => undefined;
    refreshMock.mockReturnValue(
      new Promise<{ access_token: string }>((resolve) => {
        release = resolve;
      }),
    );

    const all = Promise.all([session.refresh(), session.refresh(), session.refresh()]);
    release({ access_token: 'token-1' });

    expect(await all).toEqual(['token-1', 'token-1', 'token-1']);
    // The whole point. Three here would mean two replayed rotation tokens and a revoked
    // session family.
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('starts a new refresh once the previous one has settled', async () => {
    const session = await loadSession();
    refreshMock
      .mockResolvedValueOnce({ access_token: 'token-1' })
      .mockResolvedValueOnce({ access_token: 'token-2' });

    expect(await session.refresh()).toBe('token-1');
    expect(await session.refresh()).toBe('token-2');
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it('clears the token when refresh fails, so a later call retries rather than reusing it', async () => {
    const session = await loadSession();
    refreshMock.mockRejectedValueOnce(session.httpError(401, 'SESSION_REVOKED'));

    await expect(session.refresh()).rejects.toThrow(session.ApiError);
    expect(session.getAccessToken()).toBeNull();
  });
});

describe('withAuth', () => {
  it('refreshes once and replays the call on an expired token', async () => {
    const session = await loadSession();
    refreshMock
      .mockResolvedValueOnce({ access_token: 'stale' })
      .mockResolvedValueOnce({ access_token: 'fresh' });

    const call = vi
      .fn<(token: string) => Promise<string>>()
      .mockRejectedValueOnce(session.httpError(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce('data');

    expect(await session.withAuth(call)).toBe('data');
    expect(call).toHaveBeenNthCalledWith(1, 'stale');
    expect(call).toHaveBeenNthCalledWith(2, 'fresh');
  });

  it('does not retry a non-auth failure', async () => {
    const session = await loadSession();
    refreshMock.mockResolvedValue({ access_token: 'token-1' });

    const forbidden = session.httpError(403, 'FORBIDDEN');
    const call = vi.fn<(token: string) => Promise<string>>().mockRejectedValue(forbidden);

    await expect(session.withAuth(call)).rejects.toBe(forbidden);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('treats SESSION_REVOKED as final — refreshing cannot recover a revoked family', async () => {
    const session = await loadSession();
    refreshMock.mockResolvedValueOnce({ access_token: 'token-1' });

    const revoked = session.httpError(401, 'SESSION_REVOKED');
    const call = vi.fn<(token: string) => Promise<string>>().mockRejectedValue(revoked);

    await expect(session.withAuth(call)).rejects.toBe(revoked);
    expect(call).toHaveBeenCalledTimes(1);
  });
});

describe('restore', () => {
  it('is false, not a throw, when there is no valid cookie', async () => {
    const session = await loadSession();
    refreshMock.mockRejectedValueOnce(session.httpError(401, 'REFRESH_TOKEN_INVALID'));
    await expect(session.restore()).resolves.toBe(false);
  });

  it('rethrows a network failure — unreachable is not the same as signed out', async () => {
    const session = await loadSession();
    refreshMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(session.restore()).rejects.toThrow(TypeError);
  });
});

describe('proactive refresh', () => {
  it('schedules the next refresh at 80% of the access token lifetime', async () => {
    const session = await loadSession();
    refreshMock.mockResolvedValue({ access_token: 'token-1' });

    await session.refresh();
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // Just before 12 minutes: nothing yet. A reactive-on-401 client would sit here until a
    // request failed, which for the driver app means a token lapsing mid-shift.
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000 + 59_000);
    expect(refreshMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });
});
