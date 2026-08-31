import type { Request } from 'express';

/**
 * The unparsed request body, kept for the routes whose signature has to be verified against the
 * exact bytes that were sent.
 *
 * `JSON.parse` followed by `JSON.stringify` does NOT round-trip: key order, whitespace and
 * number formatting all move, and an HMAC over the result will not match one computed by the
 * sender. So the raw text has to be captured on the way in, before parsing.
 *
 * CAPTURED ONLY FOR THE ROUTES THAT NEED IT — see `RAW_BODY_ROUTES` and the `verify` hook in
 * `app.ts`. Holding a second copy of every request body in memory to serve two endpoints is the
 * kind of cost that never shows up in review and does show up under load.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: string;
    }
  }
}

/** Route suffixes whose raw body is retained. Matched with `endsWith` on the request path. */
export const RAW_BODY_ROUTES = ['/payments/webhook'] as const;

/**
 * Takes `string | undefined` because the `verify` hook runs against a bare Node `IncomingMessage`,
 * where `url` is optional. An absent url captures nothing, which is the safe answer.
 */
export function shouldCaptureRawBody(url: string | undefined): boolean {
  if (url === undefined) return false;
  const path = url.split('?')[0] ?? url;
  return RAW_BODY_ROUTES.some((route) => path.endsWith(route));
}

export function getRawBody(req: Request): string | undefined {
  return req.rawBody;
}
