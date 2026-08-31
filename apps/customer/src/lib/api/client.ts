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
  const { method = 'GET', body, token, query, idempotencyKey, signal } = options;

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

  if (payload.success === false) throw new ApiError(payload);

  return payload.data;
}
