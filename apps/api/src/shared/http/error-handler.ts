import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { CoordinateError } from '@driverzone/geo';
import { AppError } from '@/shared/errors/AppError.js';
import { logger } from '@/shared/logging/logger.js';
import { buildErrorBody } from './response.util.js';

/**
 * The single place an error becomes a response.
 *
 * Translates the error types the app actually throws into the wire envelope, and decides what
 * gets logged at which level. Anything unrecognised is a genuine fault: logged with its stack,
 * reported to the caller as a generic 500.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    // Expected errors are traffic, not incidents. Logging them at `error` trains everyone to
    // ignore the error log, which is how a real fault goes unnoticed.
    logger[err.isExpected ? 'info' : 'error']('request failed', {
      code: err.code,
      status: err.statusCode,
      url: req.originalUrl,
      details: err.details,
      ...(err.isExpected ? {} : { stack: err.stack }),
    });

    res.status(err.statusCode).json(
      buildErrorBody(req, {
        statusCode: err.statusCode,
        code: err.code,
        message: err.message,
        details: err.details,
        stack: err.stack,
      }),
    );
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json(
      buildErrorBody(req, {
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: 'Some of the details provided are not valid.',
        details: err.issues,
      }),
    );
    return;
  }

  // A swapped lat/lng reaching this far is a client bug, not a server fault — 400, and the
  // message from @driverzone/geo already names the likely cause.
  if (err instanceof CoordinateError) {
    res.status(400).json(
      buildErrorBody(req, {
        statusCode: 400,
        code: 'INVALID_COORDINATE',
        message: err.message,
      }),
    );
    return;
  }

  const stack = err instanceof Error ? err.stack : undefined;
  logger.error('unhandled error', { url: req.originalUrl, err: String(err), stack });

  res.status(500).json(
    buildErrorBody(req, {
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Something went wrong. Please try again shortly.',
      stack,
    }),
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(
    buildErrorBody(req, {
      statusCode: 404,
      code: 'NOT_FOUND',
      message: `No route matches ${req.method} ${req.originalUrl}`,
    }),
  );
}
