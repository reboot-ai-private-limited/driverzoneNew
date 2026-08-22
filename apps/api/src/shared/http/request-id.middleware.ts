import type { RequestHandler } from 'express';
import { newRequestId } from '@/shared/ids.js';
import { runWithContext } from './request-context.js';

/** Header name, lowercase — Node normalises incoming headers, and this is the de facto standard. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Assigns every request an ID and makes it visible to the whole call tree.
 *
 * An inbound header wins when present, so a trace started at nginx (or by a mobile client
 * retrying) stays one trace instead of becoming two unrelated ones. Generated otherwise.
 *
 * The `req_` + UUID v7 shape comes from docs/LLD/08-api-contracts.md, which specifies
 * `"request_id": "req_01J…"` and keys internal causes in the logs by it. v7 sorts by creation
 * time, so a request's log lines group in the order they happened — see `shared/ids.ts`.
 *
 * Registered FIRST in `createApp`, ahead of helmet and cors, so a request rejected by CORS is
 * still traceable. A rejection you cannot correlate is the one you most need to.
 */
export function requestIdMiddleware(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.headers[REQUEST_ID_HEADER];
    // A repeated header arrives as an array. Take the first rather than serialising the array
    // into the log as "a,b".
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim() || newRequestId();

    // Set before next(), so the header is present even on responses that never reach a route.
    res.setHeader(REQUEST_ID_HEADER, requestId);

    runWithContext({ requestId }, next);
  };
}
