import type { AuthUserDto, OtpVerifyResponse } from '@driverzone/contracts';
import { AppState } from 'react-native';
import { ApiError } from '../api/ApiError';
import { setTokenRefresher } from '../api/client';
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
 *   - Renewal is PROACTIVE, on a timer at 80% of the 15-minute TTL. auth.md singles the driver
 *     app out for this: it runs a foreground service for a whole shift, and a token lapsing on a
 *     weak signal is a working driver logged out, not just a retry.
 *   - It is ALSO reactive, in two places the timer cannot cover, because a `setTimeout` is not a
 *     guarantee on Android: the JS timer loop is suspended while the app is backgrounded, so the
 *     renewal that was supposed to happen at minute 12 simply does not happen if the phone was in
 *     a pocket. So the client retries once on a 401 (see `setTokenRefresher` below), and the app
 *     re-checks whenever it returns to the foreground.
 *   - Renewal is SINGLE-FLIGHT. This is the dangerous part: refresh tokens ROTATE, and auth.md
 *     defines presenting a spent one as theft — it revokes the entire session family. Two
 *     screens refreshing concurrently would log the driver out mid-shift, by their own app, for
 *     doing nothing wrong. One promise, shared.
 *   - A FAILED RENEWAL IS NOT A DEAD SESSION. Only a 401 ends one. See `isSessionRejection`.
 */

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const RENEW_AT_FRACTION = 0.8;

/**
 * Treat a token with less than this left as already spent.
 *
 * Covers the gap between deciding to use a token and the server reading it — a request issued at
 * T-5s on a slow connection arrives expired, and the whole point of the resume check is to not
 * send it.
 */
const EXPIRY_SKEW_MS = 60 * 1000;

/**
 * How soon to try again after a renewal that failed for a reason that might pass.
 *
 * Without this, a transient failure left NO timer scheduled — the proactive path is armed only on
 * success — so a driver who lost signal for ten seconds at the wrong moment had no renewal pending
 * at all, and stayed on a dying token until something 401'd.
 */
const TRANSIENT_RETRY_MS = 60 * 1000;

export type SessionStatus = 'booting' | 'authenticated' | 'anonymous';

export interface SessionState {
  status: SessionStatus;
  user: AuthUserDto | null;
  /** True on the verify that created the account — the caller routes into onboarding. */
  isNewUser: boolean;
}

let accessToken: string | null = null;
/** Epoch ms at which `accessToken` lapses. 0 when there is none. */
let accessTokenExpiresAt = 0;
let state: SessionState = { status: 'booting', user: null, isNewUser: false };
let renewTimer: ReturnType<typeof setTimeout> | null = null;
let inFlightRenewal: Promise<string | null> | null = null;

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

/**
 * Is there a refresh token on this device at all?
 *
 * The question "might this driver be signed in?", answerable WITHOUT a round-trip — which is the
 * one thing `restore()` cannot offer, since proving a session costs a request. The boot screen
 * uses it when its own timeout fires: a restore that has not answered in eight seconds says
 * nothing about whether the driver is signed in, only that the network is slow, and bouncing them
 * to the login screen on that basis is the same mistake as bouncing them for being offline.
 */
export async function hasStoredSession(): Promise<boolean> {
  return (await readRefreshToken()) !== null;
}

function scheduleRenewal(inMs: number = ACCESS_TOKEN_TTL_MS * RENEW_AT_FRACTION): void {
  if (renewTimer !== null) clearTimeout(renewTimer);
  renewTimer = setTimeout(() => {
    void renew();
  }, inMs);
}

/**
 * Is the token in hand still good enough to send?
 *
 * Exported for the resume check at the bottom of the file. `false` when there is no token at all,
 * which is the state a boot that could not reach the server leaves behind.
 */
export function isAccessTokenFresh(): boolean {
  return accessToken !== null && Date.now() < accessTokenExpiresAt - EXPIRY_SKEW_MS;
}

/**
 * IS THIS FAILURE THE END OF THE SESSION, OR JUST A BAD MOMENT? The single most important
 * question in this file, and the bug that logged working drivers out.
 *
 * `renew()` used to answer "the end" for everything it caught. A `NetworkError` from a phone
 * whose radio was still reconnecting, a 502 from a deploying API, a captive portal on a petrol
 * station's wifi — each one destroyed the refresh token and dropped the driver on the login
 * screen mid-shift, with no way back but a fresh OTP. On a handset those failures are routine;
 * the token being genuinely dead is rare.
 *
 * The server makes the distinction unambiguous, so there is no guessing here: BOTH refresh
 * rejections — `REFRESH_TOKEN_INVALID` and `SESSION_REVOKED` — are 401 (see
 * `identity.errors.ts`). Anything that is not a 401 from the API is something that may pass, and
 * the stored refresh token is kept so it can.
 *
 * Erring towards "keep" is deliberate. Keeping a session that is truly dead costs one more failed
 * request, which then answers 401 and ends it properly. Discarding a live one costs a driver
 * their shift.
 */
function isSessionRejection(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 401;
}

function stopRenewal(): void {
  if (renewTimer !== null) clearTimeout(renewTimer);
  renewTimer = null;
}

async function applyTokens(access: string, refresh: string | undefined): Promise<void> {
  accessToken = access;
  accessTokenExpiresAt = Date.now() + ACCESS_TOKEN_TTL_MS;
  // The server rotates on every refresh, so an absent `refresh_token` means "keep the one you
  // have" — overwriting the stored value with nothing would strand the next launch.
  if (refresh !== undefined) await writeRefreshToken(refresh);
  scheduleRenewal();
}

/**
 * Exchange the stored refresh token for a new access token.
 *
 * Returns the new access token, or `null` for "no token right now" — which is deliberately NOT
 * the same as "signed out". A `null` means either the session was rejected (in which case this
 * has already ended it and cleared the keystore) or renewal could not complete (in which case the
 * refresh token is untouched and worth trying again). Callers that need to tell the two apart ask
 * `hasStoredSession()`; `restore()` is the worked example.
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
    } catch (cause) {
      /*
       * REVOKED OR ROTATED OUT — the session is genuinely over. Not a toast, not a retry: the
       * login screen, and the stored refresh token is destroyed on the way.
       *
       * When duty lands (docs/LLD/driver-app.md S-6), this is also where the foreground service
       * and location pings must be torn down: a logged-out driver must never still look on-duty
       * to dispatch, or offers get sent into the void.
       */
      if (isSessionRejection(cause)) {
        await endSession();
        return null;
      }

      /*
       * EVERYTHING ELSE — offline, a captive portal, a 5xx, a request that timed out. The refresh
       * token is deliberately LEFT ALONE: it is very probably still valid, and deleting it would
       * turn a momentary lapse in signal into a re-registration the driver has to do by hand.
       *
       * A short retry is armed because nothing else would arm one — the proactive timer is only
       * scheduled on success, so without this a driver who lost signal at the wrong second would
       * carry a dying token with no renewal pending until something 401'd.
       *
       * The caller gets `null`, meaning "no token right now". That is not the same as "signed
       * out", and `restore()` below is careful to tell the two apart.
       */
      scheduleRenewal(TRANSIENT_RETRY_MS);
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

  // The refresh response carries no user; the profile query fills that in once the app is past
  // the boot screen.
  if (token !== null) {
    publish({ status: 'authenticated', user: state.user, isNewUser: false });
    return 'authenticated';
  }

  /**
   * A `null` from `renew()` has TWO meanings, and collapsing them is what made an offline launch
   * destructive.
   *
   * If the session was rejected, `renew()` has already ended it and cleared the keystore — so the
   * absence of a stored refresh token below is the signal that the driver really is signed out.
   *
   * If renewal merely FAILED — no signal, a captive portal, the API mid-deploy — the token is
   * still there, and the honest answer is "we believe there is a session, we just cannot prove it
   * yet". Reporting `anonymous` there sent a driver with a perfectly good session to the login
   * screen to re-enter their number, which they cannot even complete without the network that
   * just failed.
   *
   * So we proceed as authenticated. Nothing is faked: there is no access token, so the first call
   * `gate.tsx` makes answers 401, the client's recovery retries the refresh, and if that still
   * cannot reach the server the gate shows its own "could not load your account" state — which
   * already has a Try again button and a deliberate Sign out beside it. That is the correct place
   * for a network failure to surface, and the driver keeps their session either way.
   */
  const sessionSurvives = (await readRefreshToken()) !== null;
  if (sessionSurvives) {
    publish({ status: 'authenticated', user: state.user, isNewUser: false });
    return 'authenticated';
  }

  publish({ status: 'anonymous', user: null, isNewUser: false });
  return 'anonymous';
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
  accessTokenExpiresAt = 0;
  await clearRefreshToken();
  publish({ status: 'anonymous', user: null, isNewUser: false });
}

/**
 * Sign out. Tells the server first so the refresh family is revoked rather than left live until
 * it expires, but a failed call still clears this device — a driver who taps log out is logged
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

/**
 * THE TWO REACTIVE PATHS, wired at module scope so they exist for the life of the process rather
 * than the life of a component. A renewal that stops because a screen unmounted is a token that
 * stops renewing when a driver navigates — the same reason the timer above is not in a hook.
 */

/**
 * 1. THE 401 PATH. `client.ts` calls this when any request comes back with an expired token, and
 *    retries that request once with whatever comes out.
 *
 *    Inverted rather than imported: session already depends on `endpoints/auth`, which depends on
 *    the client, so a direct import the other way would close the cycle. Handing `renew` over
 *    keeps the arrow pointing one way and gives the client the single-flight guarantee for free.
 */
setTokenRefresher(renew);

/**
 * 2. THE RESUME PATH, and the one that matters most on Android.
 *
 *    The proactive timer is a `setTimeout`, and Android suspends the JS timer loop while the app
 *    is backgrounded — the foreground service keeps the PROCESS resident so FCM can wake it, but
 *    it does not keep timers firing. A driver whose phone sat in a pocket through a 20-minute
 *    fare comes back to a token that expired at minute 15 and a renewal that never ran.
 *
 *    Checking on `active` closes that window before any screen can issue a request with a dead
 *    token. It is cheap: a fresh token short-circuits, so an app switch costs one comparison.
 *
 *    Guarded on `authenticated` so it never fires on the login screen, where there is nothing to
 *    renew and `renew()` would only re-confirm that.
 */
AppState.addEventListener('change', (next) => {
  if (next !== 'active') return;
  if (state.status !== 'authenticated') return;
  if (isAccessTokenFresh()) return;
  void renew();
});
