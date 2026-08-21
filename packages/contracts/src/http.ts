/**
 * The envelope every /api route returns.
 *
 * Single source of truth for four consumers — the API that produces it, the admin panel, and
 * both mobile apps. Under waagent this file was hand-mirrored into the API and drifted; here
 * `apps/api` depends on this package directly, because a mismatch that reaches a store binary
 * cannot be hotfixed (docs/engineering/07-shared-packages.md).
 */

export interface RequestMeta {
  method: string;
  url: string;
  /** Omitted in production. */
  ip?: string;
}

export interface HttpSuccessBody<T = unknown> {
  success: true;
  statusCode: number;
  request: RequestMeta;
  message: string;
  data: T;
}

export interface HttpErrorBody {
  success: false;
  statusCode: number;
  code: string;
  request: RequestMeta;
  message: string;
  data?: unknown;
  /** Stack trace — omitted in production. */
  trace?: string;
}

export type HttpBody<T = unknown> = HttpSuccessBody<T> | HttpErrorBody;

export function isHttpError<T>(body: HttpBody<T>): body is HttpErrorBody {
  return body.success === false;
}

/** Money crosses the wire twice: as integer paise to compute with, as a string to render. */
export interface Money {
  amount_paise: number;
  /** Preformatted, e.g. "₹1,050" — so all four clients render identically. */
  amount_display: string;
}

export interface LatLngDto {
  lat: number;
  lng: number;
}
