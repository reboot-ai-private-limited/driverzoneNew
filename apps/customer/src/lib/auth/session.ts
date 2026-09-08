import { AppState } from 'react-native';
import type { AuthUserDto, OtpVerifyResponse } from '@driverzone/contracts';
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

/**
 * Is there a refresh token on this device at all?
 *
 * The question "might this customer be signed in?", answerable WITHOUT a round-trip — which is
 * the one thing `restore()` cannot offer, since proving a session costs a request. The boot screen
 * uses it when its own timeout fires: a restore that has not answered in eight seconds says
 * nothing about whether the customer is signed in, only that the network is slow.
 */
export async function hasStoredSession(): Promise<boolean> {
  return (await readRefreshToken()) !== null;
}

/**
 * How soon to try again after a renewal that failed for a reason that might pass.
 *
 * Without this a transient failure left NO timer scheduled — the proactive path is armed only on
 * success — so a customer who lost signal for ten seconds at the wrong moment had no renewal
 * pending at all and stayed on a dying token until something 401'd.
 */
const TRANSIENT_RETRY_MS = 60 * 1000;

/**
 * IS THIS FAILURE THE END OF THE SESSION, OR JUST A BAD MOMENT?
 *
 * `renew()` used to answer "the end" for everything it caught. A `NetworkError` from a phone whose
 * radio was still reconnecting, a 502 from a deploying API, a captive portal on café wifi — each
 * one destroyed the refresh token and dropped the customer on the login screen, with no way back
 * but a fresh OTP. On a handset those failures are routine; the token being genuinely dead is
 * rare.
 *
 * The server makes the distinction unambiguous, so there is no guessing: BOTH refresh rejections
 * — `REFRESH_TOKEN_INVALID` and `SESSION_REVOKED` — are 401 (`identity.errors.ts`). Anything that
 * is not a 401 from the API may pass, and the stored refresh token is kept so it can.
 *
 * Erring towards "keep" is deliberate. Keeping a dead session costs one more failed request, which
 * then answers 401 and ends it properly. Discarding a live one costs the customer their account.
 */
function isSessionRejection(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 401;
}

function scheduleRenewal(inMs: number = ACCESS_TOKEN_TTL_MS * RENEW_AT_FRACTION): void {
  if (renewTimer !== null) clearTimeout(renewTimer);
  renewTimer = setTimeout(() => {
    void renew();
  }, inMs);
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
    } catch (cause) {
      /*
       * REVOKED OR ROTATED OUT — the session is genuinely over. Not a toast, not a retry: the
       * login screen, and the stored refresh token is destroyed on the way.
       */
      if (isSessionRejection(cause)) {
        await endSession();
        return null;
      }

      /*
       * EVERYTHING ELSE — offline, a captive portal, a 5xx, a request that timed out. The refresh
       * token is deliberately LEFT ALONE: it is very probably still valid, and deleting it would
       * turn a momentary lapse in signal into a fresh OTP the customer has to sit through.
       *
       * A short retry is armed because nothing else would arm one — the proactive timer is only
       * scheduled on success.
       *
       * `null` here means "no token right now", which is NOT "signed out"; `restore()` below is
       * careful to tell the two apart.
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

  // The refresh response carries no user. The profile fetch that fills this in lands with the
  // account screens; until then an authenticated boot is enough to leave the login flow.
  if (token !== null) {
    publish({ status: 'authenticated', user: state.user, isNewUser: false });
    return 'authenticated';
  }

  /**
   * A `null` from `renew()` has TWO meanings, and collapsing them is what made an offline launch
   * destructive.
   *
   * If the session was rejected, `renew()` has already ended it and cleared the keystore — so the
   * absence of a stored refresh token below is the signal that the customer really is signed out.
   *
   * If renewal merely FAILED — no signal, a captive portal, the API mid-deploy — the token is
   * still there, and the honest answer is "we believe there is a session, we just cannot prove it
   * yet". Reporting `anonymous` there sent a signed-in customer to re-enter their number, which
   * they cannot even complete without the network that just failed.
   *
   * So we proceed as authenticated. Nothing is faked: there is no access token, so the first
   * authenticated call answers 401, the client's recovery retries the refresh, and a screen that
   * still cannot reach the server shows its own error — the right place for a network failure.
   */
  if (await hasStoredSession()) {
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

/**
 * THE 401 PATH, wired at module scope so it exists for the life of the process.
 *
 * `client.ts` calls this when any request comes back with an expired token, and retries that
 * request once with whatever comes out. Inverted rather than imported: session already depends on
 * `endpoints/auth`, which depends on the client, so a direct import the other way would close the
 * cycle. Handing `renew` over also gives the client the single-flight guarantee for free.
 */
setTokenRefresher(renew);
