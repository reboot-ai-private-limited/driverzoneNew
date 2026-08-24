import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';
import { createApp } from '../src/app.js';
import { AppError } from '../src/shared/errors/AppError.js';
import { asyncHandler } from '../src/shared/http/asyncHandler.js';
import { errorHandler, notFoundHandler } from '../src/shared/http/error-handler.js';
import { requestIdMiddleware } from '../src/shared/http/request-id.middleware.js';

/**
 * The HTTP layer, driven end to end through supertest with no port and no database.
 *
 * `test/health.test.ts` covers the domain; this covers everything between a socket and a use
 * case — the envelope, the error translation, the correlation ID. None of it was exercised
 * before, which is how a 400 that returns no field information reached production-shaped code.
 */

/** A minimal app with the same middleware stack, so a route can be made to throw on demand. */
function appThatThrows(err: unknown) {
  const app = express();
  app.use(requestIdMiddleware());
  app.get(
    '/boom',
    asyncHandler(() => Promise.reject(err)),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('response envelope', () => {
  it('wraps a success in the shared envelope', async () => {
    const res = await request(createApp()).get('/api/health');

    expect(res.body).toMatchObject({
      success: true,
      message: 'Health check',
      request: { method: 'GET', url: '/api/health' },
    });
    expect(res.body.data.dependencies).toBeInstanceOf(Array);
  });

  it('returns 503 rather than 200 when a dependency is down', async () => {
    // Nothing is connected in this test process, so both probes report down. The status code is
    // the assertion that matters: a 200 with `status: "degraded"` in the body reads fine to a
    // human and is invisible to every orchestrator in existence.
    const res = await request(createApp()).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.data.status).toBe('degraded');
  });
});

describe('request id', () => {
  it('generates one and returns it in the header and the body', async () => {
    const res = await request(createApp()).get('/api/health');

    const header = res.headers['x-request-id'];
    // req_ + UUID v7, per docs/LLD/api-contracts.md. The `7` in the third group is the
    // version nibble — asserting it is what distinguishes a sortable ID from a random one.
    expect(header).toMatch(/^req_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(res.body.request.requestId).toBe(header);
  });

  it('reuses an inbound id so a trace started upstream stays one trace', async () => {
    const res = await request(createApp())
      .get('/api/health')
      .set('x-request-id', 'trace-from-nginx');

    expect(res.headers['x-request-id']).toBe('trace-from-nginx');
    expect(res.body.request.requestId).toBe('trace-from-nginx');
  });

  it('is present on responses that never reach a route', async () => {
    const res = await request(createApp()).get('/api/nothing-here');

    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.body.request.requestId).toBe(res.headers['x-request-id']);
  });
});

describe('error handling', () => {
  it('renders an AppError with its status and code', async () => {
    const res = await request(appThatThrows(AppError.notFound('No such booking.'))).get('/boom');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
      message: 'No such booking.',
    });
  });

  it('returns validation issues to the caller', async () => {
    const err = new ZodError(
      z.object({ phone: z.string().min(10) }).safeParse({ phone: '123' }).error!.issues,
    );

    const res = await request(appThatThrows(err)).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    // The point of the publicDetails channel: a client cannot highlight the offending field
    // without being told which one it is.
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data[0].path).toContain('phone');
  });

  it('keeps publicDetails and drops nothing the caller needs', async () => {
    const err = AppError.badRequest('Check the highlighted fields.', [{ field: 'pickup' }]);

    const res = await request(appThatThrows(err)).get('/boom');

    expect(res.status).toBe(400);
    expect(res.body.data).toEqual([{ field: 'pickup' }]);
  });

  it('turns an unrecognised throw into a generic 500', async () => {
    const res = await request(appThatThrows(new Error('mongo exploded'))).get('/boom');

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('INTERNAL');
    // The real message must not reach the caller.
    expect(res.body.message).not.toContain('mongo');
  });

  it('carries the cause on a wrapped fault', () => {
    const root = new Error('ECONNREFUSED');
    const wrapped = AppError.internal('INTERNAL', { where: 'zones' }, root);

    expect(wrapped.cause).toBe(root);
    expect(wrapped.isExpected).toBe(false);
  });
});
