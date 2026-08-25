import type { AuthUserDto } from '@driverzone/contracts';
import { ApiError } from '../api/ApiError';
import { authApi } from '../api/endpoints/auth';

/**
 * The admin session. Implements docs/LLD/auth.md §Token lifecycle.
 *
 * THE ACCESS TOKEN LIVES HERE, IN MEMORY, AND NOWHERE ELSE. Not localStorage, not
 * sessionStorage, not a cookie this code can read. The refresh token is httpOnly precisely so
 * an XSS cannot read it; putting the access token somewhere an XSS CAN read gives most of that
 * back for the convenience of skipping one request on reload.
 *
 * The consequence is that a hard reload has no token, which is why `restore()` exists.
 */

/** 80% of the 15-minute access TTL. Clients refresh proactively, not on a 401. */
const REFRESH_AFTER_MS = 12 * 60 * 1000;

let accessToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The in-flight refresh, shared by every caller. This single variable is the most important
 * line in the file.
 *
 * Refresh tokens ROTATE, and docs/LLD/auth.md defines presenting an already-used one as theft:
 * it revokes the entire session family. A screen with six queries that each fire their own
 * refresh has five of them present a spent token — and the admin is signed out and told to log
 * in again, by their own client, for doing nothing wrong. One promise, shared by all six.
 */
let inFlight: Promise<string> | null = null;

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

function publish(token: string | null): void {
  accessToken = token;
  for (const listener of listeners) listener(token);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAccessToken(): string | null {
  return accessToken;
}

function scheduleRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    // Nothing awaits this: it is a background renewal, and a failure here means the same as a
    // failure anywhere else — the session is over and `refresh` has already cleared it.
    void refresh().catch(() => undefined);
  }, REFRESH_AFTER_MS);
}

function adopt(token: string): string {
  publish(token);
  scheduleRefresh();
  return token;
}

function clear(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = null;
  inFlight = null;
  publish(null);
}

/**
 * Exchange the httpOnly cookie for a new access token. Single-flight — see `inFlight` above.
 */
export function refresh(): Promise<string> {
  if (inFlight !== null) return inFlight;

  inFlight = authApi
    .refresh()
    .then((data) => adopt(data.access_token))
    .catch((cause: unknown) => {
      clear();
      throw cause;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Session restore on boot. There is no other mechanism — the token was never persisted, so
 * "am I signed in?" is answered by asking the server, using the cookie.
 *
 * Resolves to `false` rather than throwing for the ordinary not-signed-in case, because that
 * is not an error and the shell should not render one.
 */
export async function restore(): Promise<boolean> {
  try {
    await refresh();
    return true;
  } catch (cause) {
    if (cause instanceof ApiError) return false;
    // A network failure is NOT "signed out". Re-throwing lets the shell say the server is
    // unreachable instead of bouncing the admin to a login screen that will also fail.
    throw cause;
  }
}

export async function signIn(mobileNumber: string, otp: string): Promise<AuthUserDto> {
  const data = await authApi.verifyOtp({ mobile_number: mobileNumber, otp });
  adopt(data.access_token);
  return data.user;
}

export async function signOut(): Promise<void> {
  try {
    await authApi.logout();
  } finally {
    // Local state is cleared whether or not the server answered. Logout is idempotent server
    // side, and an admin who clicked "sign out" must end up signed out regardless.
    clear();
  }
}

/**
 * Run an authenticated request, refreshing once if the token has expired.
 *
 * The retry is here rather than in the query layer for two reasons: the query layer must never
 * retry a 4xx, and a refresh has to be shared across concurrent callers, which a per-query
 * retry cannot do.
 */
export async function withAuth<T>(call: (token: string) => Promise<T>): Promise<T> {
  const token = accessToken ?? (await refresh());

  try {
    return await call(token);
  } catch (cause) {
    if (!(cause instanceof ApiError) || !cause.isAuthExpiry) throw cause;
    return call(await refresh());
  }
}
