import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import { RedisStore } from 'rate-limit-redis';
import { AppError } from '@/shared/errors/AppError.js';
import { getRedis } from '@/shared/queue/redis.js';

/**
 * Request throttling, backed by the Redis this process already holds.
 *
 * Redis rather than the library's default in-memory store, because the default counts per
 * PROCESS: run two API containers behind nginx and every limit silently doubles. A limit that
 * quietly scales with your replica count is worse than no limit, because it reads as one.
 *
 * Generic on purpose. `POST /quotes` at 30/min/user is already specified
 * (docs/LLD/09-architecture.md) and will use this rather than growing its own.
 *
 * NOTE: identity's OTP send/verify limits are NOT built on this. Those need to survive a
 * successful response, expose `retry_after_seconds`, and burn attempts atomically against the
 * same challenge record — see `identity/infrastructure/otpStore.redis.ts`. This middleware is
 * the blunt per-IP/per-route instrument that sits in front of everything.
 */
export interface RateLimitOptions {
  /** Window length. */
  windowMs: number;
  /** Requests permitted per key per window. */
  max: number;
  /**
   * Namespaces the Redis keys. Two limiters sharing a prefix share a counter, which is almost
   * never what you want — so this is required rather than defaulted.
   */
  prefix: string;
  /** Defaults to the client IP. Pass a function to key by user, phone number, etc. */
  keyBy?: (req: Parameters<RequestHandler>[0]) => string;
  message?: string;
}

export function rateLimitMiddleware(opts: RateLimitOptions): RequestHandler {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.max,
    // The `RateLimit-*` headers are useful to clients and cost nothing; the legacy `X-RateLimit-*`
    // pair is noise in 2026.
    standardHeaders: 'draft-7',
    legacyHeaders: false,

    store: new RedisStore({
      prefix: `rl:${opts.prefix}:`,
      /**
       * The store speaks raw Redis commands so it can work with any client; ioredis takes them
       * through `call`.
       *
       * Destructured into `(command, ...rest)` rather than spread wholesale because ioredis
       * types `call` with the command name as a required first parameter, and a `string[]`
       * spread does not satisfy that — TypeScript cannot prove the array is non-empty.
       */
      sendCommand: (command: string, ...rest: string[]) =>
        getRedis().call(command, ...rest) as Promise<never>,
    }),

    ...(opts.keyBy === undefined ? {} : { keyGenerator: opts.keyBy }),

    /**
     * Routed through `AppError` rather than the library's own JSON body, so a throttled request
     * comes back in the same envelope as every other error and carries a `request_id` the caller
     * can quote. `isExpected` stays true — being rate limited is the system working.
     */
    handler: (_req, _res, next) => {
      next(
        new AppError({
          statusCode: 429,
          code: 'RATE_LIMITED',
          message: opts.message ?? 'Too many requests. Please try again shortly.',
        }),
      );
    },
  });
}
