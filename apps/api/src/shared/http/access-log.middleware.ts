import type { RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import { logger } from '@/shared/logging/logger.js';
import { getRequestId } from './request-context.js';

/**
 * One line per request: what was asked, what came back, how long it took.
 *
 * Registered after `requestIdMiddleware`, so the access line and every application line written
 * during that request share a `requestId` and can be pulled up together.
 *
 * What is NOT logged is as deliberate as what is. Two paths are excluded, and both would
 * otherwise drown everything else:
 *
 *   /api/health      — the compose healthcheck polls it every 15 s (docker-compose.prod.yml),
 *                      which is ~5,700 lines a day carrying no information. Excluded only while
 *                      it succeeds: a failing health check is exactly what you want to see.
 *
 *   driver location  — 2,000 on-duty drivers × 1 ping / 10 s = 200 writes/s sustained, all day
 *                      (docs/LLD/09-architecture.md §Driver location). That is a metric, not a
 *                      log; at one line each it is ~17M lines a day and the single largest
 *                      item on any log bill.
 */
const SILENT_PATHS = new Set(['/api/health']);

/** Prefixes rather than exact paths, for routes that carry an ID. */
const SILENT_PREFIXES = ['/api/driver/location'];

function isSilent(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  return SILENT_PATHS.has(path) || SILENT_PREFIXES.some((p) => path.startsWith(p));
}

export function accessLogMiddleware(): RequestHandler {
  return pinoHttp({
    logger,

    /**
     * The route PATTERN, not the raw URL.
     *
     * `/api/bookings/:id` groups; `/api/bookings/8f3e…` does not — every request becomes its own
     * unique value, which makes "how often does this endpoint 500" unanswerable and puts
     * identifiers into a field that gets indexed and retained.
     *
     * `req.route` is only populated once Express has matched a handler, so unmatched requests
     * fall back to the path with its query string dropped.
     */
    customProps: (req) => {
      const route = (req as { route?: { path?: string } }).route?.path;
      const baseUrl = (req as { baseUrl?: string }).baseUrl ?? '';
      return {
        route: route === undefined ? (req.url?.split('?')[0] ?? '') : `${baseUrl}${route}`,
        requestId: getRequestId(),
      };
    },

    // Quiet on success, loud on failure — a healthcheck that starts failing must still surface.
    autoLogging: {
      ignore: (req) => isSilent(req.url ?? ''),
    },

    /**
     * Expected traffic logs at `info`; only genuine faults reach `error`. A 404 is a client
     * asking for something that is not there, not an incident — logging it at `error` trains
     * everyone to ignore the error log, which is how a real fault goes unnoticed.
     */
    customLogLevel: (_req, res, err) => {
      if (err !== undefined && err !== null) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },

    customSuccessMessage: () => 'request',
    customErrorMessage: () => 'request failed',

    /**
     * The default serialisers attach the whole req and res, headers included — which is how a
     * bearer token ends up in a log despite a redaction list, since it arrives under a shape the
     * paths do not name. Only these fields are kept.
     */
    serializers: {
      req: (req: { method?: string; url?: string }) => ({
        method: req.method,
        // Query string dropped: it carries filter values and, on some endpoints, coordinates.
        path: req.url?.split('?')[0],
      }),
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  }) as unknown as RequestHandler;
}
