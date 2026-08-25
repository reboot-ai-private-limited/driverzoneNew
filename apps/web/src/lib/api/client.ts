import type { HttpBody } from '@driverzone/contracts';
import { ApiError, NetworkError } from './ApiError';

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';

/**
 * Paths under which the admin refresh cookie is scoped. `credentials: 'include'` goes on these
 * and NOWHERE ELSE.
 *
 * The cookie is deliberately scoped to `/api/admin/auth` server-side so it is not attached to
 * every admin API call — a token that rides along on hundreds of unrelated requests has
 * hundreds of chances to leak (apps/api auth.controller.ts). Sending credentials on every
 * request here would quietly undo that from the client side.
 */
const COOKIE_SCOPED_PREFIX = '/admin/auth';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Bearer token. Supplied by the session layer, never read from storage here. */
  token?: string | undefined;
  query?: Record<string, string | number | boolean | undefined>;
  /** Required on every POST that creates or moves money (docs/LLD/api-contracts.md). */
  idempotencyKey?: string | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * The one function every request goes through. Its entire job is the envelope from
 * docs/LLD/api-contracts.md: unwrap `data` on success, throw `ApiError` on failure, so no
 * caller ever writes `if (body.success)`.
 */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, token, query, idempotencyKey, signal } = options;

  const url = new URL(BASE_URL + path);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
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
      credentials: path.startsWith(COOKIE_SCOPED_PREFIX) ? 'include' : 'omit',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    // An aborted request is the caller changing its mind, not a network fault — surfacing it
    // as one would render an error state for a query the user already navigated away from.
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new NetworkError();
  }

  const payload = (await response.json().catch(() => null)) as HttpBody<T> | null;

  // A response with no envelope is not something this API produces — it is a proxy, a gateway,
  // or nginx answering instead. Treating it as a network fault is closer to the truth than
  // inventing a code for it.
  if (payload === null || typeof payload !== 'object' || !('success' in payload)) {
    throw new NetworkError();
  }

  if (payload.success === false) throw new ApiError(payload);

  return payload.data;
}
