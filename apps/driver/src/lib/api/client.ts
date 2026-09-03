import type { HttpBody } from '@driverzone/contracts';
// `/legacy`, not the package root: the top-level `uploadAsync` is deprecated in SDK 54+ and
// throws at runtime. See the note in `uploadFile`.
import * as FileSystem from 'expo-file-system/legacy';
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
    // render an error for a screen the driver has already left.
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

/**
 * A file upload that does NOT go through the API.
 *
 * `POST /driver/documents` returns a presigned `upload_url` and the client sends the bytes
 * straight to storage (docs/LLD/architecture.md). So this deliberately does not use `request`
 * above: there is no envelope to unwrap, no bearer to attach — the provider's own signature is
 * the credential — and the response body is not ours.
 *
 * **Two shapes, chosen by whether the server sent `upload_fields`** (see the contract note on
 * `RequestDocumentUploadResponse`):
 *
 *   - **fields present → signed `multipart/form-data` POST.** Cloudinary's shape. Its
 *     `api_key`/`timestamp`/`public_id`/`type`/`signature` are HMAC'd with the API secret
 *     server-side; a client cannot construct them, and an unsigned request is rejected 401. The
 *     fields must be sent EXACTLY as given — the provider signs a specific parameter set, so an
 *     extra or altered field invalidates the signature.
 *   - **fields absent → plain PUT of the raw bytes.** The S3 presigned-URL shape, where the
 *     authorisation lives in the query string.
 *
 * **The transport is `FileSystem.uploadAsync`, not `fetch` with a `FormData`.** See the note
 * inside the function — a hand-built `FormData` fails on this stack.
 */
export async function uploadFile(
  uploadUrl: string,
  fileUri: string,
  contentType: string,
  uploadFields?: Record<string, string> | undefined,
): Promise<void> {
  /**
   * No credentials means the presign response carried none.
   *
   * Diagnosed BEFORE any transport is attempted, so the driver is told the real cause rather than
   * whatever incidental failure happens to come back first from an upload that was never going to
   * be accepted. That mattered: the previous version fell through to a raw PUT, which threw for an
   * unrelated reason, and the driver was told to check a connection that was fine.
   */
  if (uploadFields === undefined) throw new Error(MISSING_UPLOAD_CREDENTIALS);

  let result: FileSystem.FileSystemUploadResult;

  try {
    /**
     * `FileSystem.uploadAsync`, NOT `fetch` with a `FormData`.
     *
     * The obvious build is a `FormData` carrying the signed fields plus `{ uri, name, type }` for
     * the file, and on this stack it fails with **"Unsupported FormDataPart implementation"** —
     * the native module receives a part with neither `string` nor `uri`, because the `FormData`
     * bound to `global` here is not the React Native polyfill whose object-with-a-`uri` convention
     * that shape depends on.
     *
     * `uploadAsync` sidesteps the question entirely: it builds the multipart body natively from a
     * file PATH, so nothing has to survive the bridge as a pseudo-Blob. It also streams from disk
     * instead of loading the photo into the JS heap — on a cheap Android handset that is the
     * difference between a large image uploading and the app being killed mid-upload.
     *
     * Imported from `expo-file-system/legacy` deliberately: the top-level `uploadAsync` is
     * deprecated in SDK 54+ and throws at runtime.
     */
    result = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      // The field the provider reads the binary from. Everything else rides in `parameters`.
      fieldName: 'file',
      mimeType: contentType,
      // Sent EXACTLY as issued — the provider signs a specific parameter set, so an added or
      // altered field invalidates the signature.
      parameters: uploadFields,
    });
  } catch (cause) {
    // Keep the underlying reason: "Network request failed", a TLS error and a DNS failure are
    // different problems with different fixes, and flattening them into one reassuring sentence
    // is how a real fault gets misread as bad signal.
    throw new NetworkError(cause instanceof Error ? cause.message : undefined);
  }

  if (result.status < 200 || result.status >= 300) {
    /**
     * The provider's own reason — Cloudinary answers with `{ error: { message } }`, and "Invalid
     * Signature" or "File size too large" is worth far more than a generic retry prompt.
     *
     * The document row already exists as PENDING from the moment the URL was issued, so a failed
     * transfer leaves something the driver can retry rather than no record at all
     * (docs/LLD/user.md §POST /driver/documents).
     */
    const detail = providerErrorMessage(result.body);
    throw new Error(
      detail === null
        ? `The upload did not complete (HTTP ${result.status}). Please try again.`
        : `The upload did not complete: ${detail}`,
    );
  }
}

/**
 * Shown whenever the presign response carried no `upload_fields`.
 *
 * The document row already exists by this point (the server upserts it when it mints the URL), so
 * the driver is not losing work — but the photo has nowhere to go, and no amount of retrying from
 * the handset will change that. It names the actual fix rather than blaming the connection.
 */
const MISSING_UPLOAD_CREDENTIALS =
  'The server did not authorise this upload — its response carried no upload credentials. ' +
  'This is a server configuration problem, not a connection one: check the API is running the ' +
  'current build.';

/**
 * Best-effort read of a provider's error text. Never throws — this runs on the failure path.
 *
 * Takes the body as a STRING because `uploadAsync` returns one, unlike `fetch`'s `Response`.
 */
function providerErrorMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === 'string' && message !== '' ? message : null;
  } catch {
    return null;
  }
}
