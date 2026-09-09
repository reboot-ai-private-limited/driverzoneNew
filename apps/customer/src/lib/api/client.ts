import type { HttpBody } from '@driverzone/contracts';
import { API_BASE_URL } from '../config';
import { ApiError, NetworkError } from './ApiError';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Bearer token, supplied by the session layer. This module never reads storage itself. */
  token?: string | undefined;
  query?: Record<string, string | number | boolean | undefined>;
  idempotencyKey?: string | undefined;
  signal?: AbortSignal | undefined;
  /**
   * Do not attempt the refresh-and-retry below for this request.
   *
   * Set on `auth/refresh` and `auth/logout`, and on the one retry this module issues itself.
   * Without it a 401 from the refresh endpoint would ask the session layer to refresh — the call
   * that just failed — and since renewal is single-flight the retry would await the very promise
   * it was spawned from and never settle.
   */
  skipAuthRefresh?: boolean | undefined;
}

/**
 * How this module asks the session layer for a fresh access token, WITHOUT importing it.
 *
 * `auth/session.ts` registers `renew` here at module scope. It has to be inverted like this
 * because the dependency already runs the other way — session imports `endpoints/auth`, which
 * imports this file — and importing session back would close the cycle.
 */
type TokenRefresher = () => Promise<string | null>;
let refreshAccessToken: TokenRefresher | null = null;

export function setTokenRefresher(refresher: TokenRefresher): void {
  refreshAccessToken = refresher;
}

/**
 * The one function every request goes through. Its whole job is the envelope from
 * docs/LLD/api-contracts.md — unwrap `data` on success, throw on failure — so no screen ever
 * writes `if (body.success)`.
 *
 * No `credentials` handling, unlike the web client: the admin refresh cookie does not exist on
 * mobile. Customer and driver receive `refresh_token` in the response body and send it back the
 * same way (docs/LLD/auth.md), which is why this client is simpler than the panel's.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, query, idempotencyKey, signal, skipAuthRefresh } = options;

  let url = API_BASE_URL + path;
  if (query !== undefined) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.append(key, String(value));
    }
    const serialised = params.toString();
    if (serialised.length > 0) url += `?${serialised}`;
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    // An abort is the caller changing its mind, not a network fault. Surfacing it as one would
    // render an error for a screen the user has already left.
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw new NetworkError();
  }

  const payload = (await response.json().catch(() => null)) as HttpBody<T> | null;

  // No envelope means something other than our API answered — a captive portal on hotel wifi is
  // the usual culprit on a phone. Closer to a network fault than to anything we have a code for.
  if (payload === null || typeof payload !== 'object' || !('success' in payload)) {
    throw new NetworkError();
  }

  if (payload.success === false) {
    const error = new ApiError(payload);

    /**
     * THE 401 RECOVERY — one refresh, one retry.
     *
     * Renewal is proactive on a timer and on app resume, and that is still the main path. But a
     * timer is not a guarantee: Android suspends the JS timer loop while the app is backgrounded,
     * so a customer whose phone sat in a pocket comes back with a token that expired while the
     * renewal meant to prevent it never fired. Without this the resulting 401 surfaced as a screen
     * error on a perfectly valid session.
     *
     * `isAuthExpiry` is narrower than "status is 401": it excludes `SESSION_REVOKED`, which is the
     * server saying the refresh family was destroyed. Retrying that is pointless.
     *
     * `refreshAccessToken` is single-flight on the session side, so several screens hitting 401 at
     * once share one refresh — which matters because refresh tokens ROTATE, and two concurrent
     * refreshes look like a stolen token and revoke the family.
     */
    if (error.isAuthExpiry && skipAuthRefresh !== true && refreshAccessToken !== null) {
      const fresh = await refreshAccessToken();
      if (fresh !== null) {
        // `skipAuthRefresh` on the retry so a second 401 fails out rather than looping. The
        // idempotency key is deliberately REUSED: this is the same logical request, and a fresh
        // key would let a write the server already applied be applied twice.
        return request<T>(path, { ...options, token: fresh, skipAuthRefresh: true });
      }
    }

    throw error;
  }

  return payload.data;
}
