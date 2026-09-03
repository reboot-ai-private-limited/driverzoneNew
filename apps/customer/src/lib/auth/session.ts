import { AppState } from 'react-native';
import type { AuthUserDto, OtpVerifyResponse } from '@driverzone/contracts';
import * as authApi from '../api/endpoints/auth';
import { clearRefreshToken, readRefreshToken, writeRefreshToken } from './tokenStore';

/**
 * The session, as a module rather than a hook, so `client.ts` callers and React can both reach
 * it. `SessionProvider` subscribes and re-renders; nothing else imports React from here.
 *
 * Implements docs/LLD/auth.md §Token lifecycle:
 *
 *   - The ACCESS token lives in the module variable below and is never persisted. An attacker
 *     with the device's filesystem gets the refresh token from the Keystore only with the
 *     device unlocked; putting the access token beside it would hand over a ready-to-use
 *     credential for nothing in return.
 *   - Renewal is PROACTIVE, on a timer at 80% of the 15-minute TTL, not reactive on a 401. A
 *     customer tapping "Confirm booking" must not be the one who discovers the token expired.
 *   - AND ON RESUME, because a timer alone is not enough on a phone. JS timers are throttled or
 *     suspended while an app is backgrounded, so the 12-minute one does not reliably fire in a
 *     backgrounded app — a customer who checks their trip, locks the phone for twenty minutes and
 *     comes back would otherwise return to an expired token, and the trip screen's very first poll
 *     would 401. Since renewal is deliberately not reactive, nothing would recover it and the
 *     screen would show an error for a trip that is fine. Resuming is simply another moment to be
 *     proactive at.
 *   - Renewal is SINGLE-FLIGHT. This is the dangerous part: refresh tokens ROTATE, and auth.md
 *     defines presenting a spent one as theft — it revokes the entire session family. Two
 *     screens refreshing concurrently would log the customer out mid-trip, by their own app,
 *     for doing nothing wrong. One promise, shared.
 */

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const RENEW_AT_FRACTION = 0.8;

export type SessionStatus = 'booting' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: AuthUserDto | null;
  /** True on the verify that created the account — the caller routes to profile setup. */
  isNewUser: boolean;
}

let accessToken: string | null = null;
let state: SessionState = { status: 'booting', user: null, isNewUser: false };
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightRenewal: Promise<string | null> | null = null;

/**
 * When the current access token was issued, so a resume can tell a fresh token from a stale one.
 *
 * `Date.now()` rather than a decoded `exp`: this only decides whether to renew EARLY, and being
 * wrong costs one extra refresh rather than a wrong session.
 */
let accessTokenIssuedAt: number | null = null;
let appStateSubscription: { remove: () => void } | null = null;

const listeners = new Set<(next: SessionState) => void>();

export function getState(): SessionState {
  return state;
}

export function subscribe(listener: (next: SessionState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: SessionState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

/** The bearer for the next request. Callers pass it to `request({ token })`. */
export function getAccessToken(): string | null {
  return accessToken;
}

function scheduleRenewal(): void {
  if (renewTimer !== null) clearTimeout(renewTimer);
  renewTimer = setTimeout(() => {
    void renew();
  }, ACCESS_TOKEN_TTL_MS * RENEW_AT_FRACTION);
}

function stopRenewal(): void {
  if (renewTimer !== null) clearTimeout(renewTimer);
  renewTimer = null;
  accessTokenIssuedAt = null;

  appStateSubscription?.remove();
  appStateSubscription = null;
}

/**
 * Renew now if the token is old enough that the timer should already have fired.
 *
 * Called when the app comes back to the foreground. It goes through `renew()` like everything
 * else, so it shares the single-flight promise and cannot race the timer into presenting a spent
 * refresh token — which auth.md defines as theft and answers by revoking the whole family.
 */
function watchAppState(): void {
  if (appStateSubscription !== null) return;

  appStateSubscription = AppState.addEventListener('change', (next) => {
    if (next !== 'active' || accessTokenIssuedAt === null) return;

    const age = Date.now() - accessTokenIssuedAt;
    if (age >= ACCESS_TOKEN_TTL_MS * RENEW_AT_FRACTION) void renew();
  });
}

async function applyTokens(access: string, refresh: string | undefined): Promise<void> {
  accessToken = access;
  accessTokenIssuedAt = Date.now();
  // The server rotates on every refresh, so an absent `refresh_token` means "keep the one you
  // have" — overwriting the stored value with nothing would strand the next launch.
  if (refresh !== undefined) await writeRefreshToken(refresh);
  scheduleRenewal();
  watchAppState();
}

/**
 * Exchange the stored refresh token for a new access token. Returns the new access token, or
 * `null` when there is no usable session — the caller then shows the login screen.
 *
 * Every path through this function goes through the same shared promise; see the single-flight
 * note at the top of the file.
 */
export function renew(): Promise<string | null> {
  if (inFlightRenewal !== null) return inFlightRenewal;

  inFlightRenewal = (async (): Promise<string | null> => {
    const stored = await readRefreshToken();
    if (stored === null) {
      await endSession();
      return null;
    }

    try {
      const result = await authApi.refresh({ refresh_token: stored });
      await applyTokens(result.access_token, result.refresh_token);
      // A renewal on a live session must not clobber the user we already have. `booting` is the
      // one case where there is nothing to preserve and the boot restore below fills it in.
      if (state.status === 'authenticated') publish({ ...state });
      return result.access_token;
    } catch {
      // Any failure here — revoked, rotated out, expired, or the device offline for longer than
      // the refresh TTL — ends in the same place. Not a toast, not a retry: the login screen.
      await endSession();
      return null;
    } finally {
      inFlightRenewal = null;
    }
  })();

  return inFlightRenewal;
}

/**
 * Called once on launch. There is no stored access token by design, so restoring a session
 * always costs one round-trip before the app can render past the splash — which is exactly what
 * the boot screen in `app/index.tsx` is for.
 */
export async function restore(): Promise<SessionStatus> {
  const token = await renew();
  if (token === null) {
    publish({ status: 'anonymous', user: null, isNewUser: false });
    return 'anonymous';
  }
  // The refresh response carries no user. The profile fetch that fills this in lands with the
  // account screens; until then an authenticated boot is enough to leave the login flow.
  publish({ status: 'authenticated', user: state.user, isNewUser: false });
  return 'authenticated';
}

/** Adopt the tokens from a successful `otp/verify`. */
export async function beginSession(result: OtpVerifyResponse): Promise<void> {
  await applyTokens(result.access_token, result.refresh_token);
  publish({
    status: 'authenticated',
    user: result.user,
    isNewUser: result.is_new_user === true,
  });
}

/** Local teardown. Idempotent, and safe to call when there was never a session. */
export async function endSession(): Promise<void> {
  stopRenewal();
  accessToken = null;
  await clearRefreshToken();
  publish({ status: 'anonymous', user: null, isNewUser: false });
}

/**
 * Sign out. Tells the server first so the refresh family is revoked rather than left live until
 * it expires, but a failed call still clears this device — a customer who taps log out is logged
 * out, whatever the network did.
 */
export async function signOut(): Promise<void> {
  const stored = await readRefreshToken();
  if (stored !== null) {
    try {
      await authApi.logout({ refresh_token: stored });
    } catch {
      // Deliberately swallowed; see above.
    }
  }
  await endSession();
}
