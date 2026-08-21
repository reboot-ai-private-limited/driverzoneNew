import type { HttpErrorBody, HttpSuccessBody, RequestMeta } from '@driverzone/contracts';
import type { Request, Response } from 'express';
import { isProduction } from '@/config/env.js';

/**
 * The two functions that build every response body.
 *
 * The envelope shape lives in @driverzone/contracts and is imported, not redeclared — all four
 * apps read the same definition, so a field renamed here is a type error in the admin panel and
 * both mobile apps rather than a runtime surprise in a shipped binary.
 */

function meta(req: Request): RequestMeta {
  return {
    method: req.method,
    url: req.originalUrl,
    // Omit the key rather than set it to undefined — with exactOptionalPropertyTypes those
    // are different things, and `{ ip: undefined }` would serialise a null into the envelope.
    ...(isProduction || req.ip === undefined ? {} : { ip: req.ip }),
  };
}

export function sendSuccess<T>(
  req: Request,
  res: Response,
  data: T,
  message = 'OK',
  statusCode = 200,
): void {
  const body: HttpSuccessBody<T> = { success: true, statusCode, request: meta(req), message, data };
  res.status(statusCode).json(body);
}

/** Builds only the keys that have a value — see the note on omission in `meta`. */
function diagnostics(details: unknown, stack?: string): Partial<Pick<HttpErrorBody, 'data' | 'trace'>> {
  return {
    ...(details === undefined ? {} : { data: details }),
    ...(stack === undefined ? {} : { trace: stack }),
  };
}

export function buildErrorBody(
  req: Request,
  opts: {
    statusCode: number;
    code: string;
    message: string;
    details?: unknown;
    stack?: string | undefined;
  },
): HttpErrorBody {
  return {
    success: false,
    statusCode: opts.statusCode,
    code: opts.code,
    request: meta(req),
    message: opts.message,
    // Details and stack are diagnostics. In production they would leak internals to whoever
    // triggered the error, so they are logged instead of returned.
    ...(isProduction ? {} : diagnostics(opts.details, opts.stack)),
  };
}
