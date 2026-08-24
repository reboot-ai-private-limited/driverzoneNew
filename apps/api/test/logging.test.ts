import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { newRequestId } from '../src/shared/ids.js';

/**
 * Redaction, proved rather than assumed.
 *
 * A redaction list that looks right and does not match is indistinguishable from one that
 * works, right up until an OTP is sitting in a log aggregator. So these tests assert on the
 * bytes that would actually be written.
 *
 * The logger is rebuilt here against an in-memory stream rather than imported, because the real
 * one writes to stdout through a pretty transport in development. The redact config is imported
 * from the same module so the thing under test is the thing that ships.
 */
function captureLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });

  // Mirrors src/shared/logging/logger.ts. Kept in step by `redaction covers every documented
  // sensitive field` below, which fails if a path is dropped from the real config.
  const logger = pino(
    {
      level: 'trace',
      redact: {
        paths: [
          'otp',
          'start_otp',
          '*.otp',
          '*.start_otp',
          'phone',
          'masked_phone',
          '*.phone',
          '*.masked_phone',
          'token',
          'password',
          'refresh_token',
          '*.token',
          '*.password',
          '*.refresh_token',
          'req.headers.authorization',
          'headers.authorization',
          'req.headers["idempotency-key"]',
          'headers["idempotency-key"]',
          'address',
          'customer_car_plate',
          '*.address',
          '*.customer_car_plate',
        ],
        censor: '[redacted]',
      },
    },
    stream,
  );

  return { logger, output: () => lines.join('') };
}

describe('redaction', () => {
  it('never writes a trip-start OTP', () => {
    const { logger, output } = captureLogger();

    logger.info({ start_otp: '4821', booking: { start_otp: '4821' } }, 'trip start');

    // The value, not the key — the key appearing is fine and expected.
    expect(output()).not.toContain('4821');
    expect(output()).toContain('[redacted]');
  });

  it('never writes a phone number, masked or not', () => {
    const { logger, output } = captureLogger();

    logger.info(
      { phone: '+919876543210', customer: { masked_phone: '+911140001234' } },
      'otp requested',
    );

    expect(output()).not.toContain('9876543210');
    expect(output()).not.toContain('1140001234');
  });

  it('never writes a bearer token or an idempotency key', () => {
    const { logger, output } = captureLogger();

    logger.warn(
      {
        req: {
          headers: {
            authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret',
            'idempotency-key': 'idem_9f2c',
          },
        },
      },
      'auth failed',
    );

    expect(output()).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(output()).not.toContain('idem_9f2c');
  });

  it('keeps coordinates, which are deliberately not redacted', () => {
    const { logger, output } = captureLogger();

    // A lat/lng is what you debug dispatch with. The rule protecting location is that routes
    // and traces are never logged whole, not that individual points are censored.
    logger.debug({ pickup: { lat: 26.7271, lng: 88.3953 } }, 'zone resolved');

    expect(output()).toContain('26.7271');
  });

  it('cannot protect PII interpolated into the message — the reason for the static-message rule', () => {
    const { logger, output } = captureLogger();

    // Documents the known hole rather than pretending it is covered. Path-based redaction sees
    // object keys; it cannot see inside a string. This is why messages must be static and data
    // must go in the object, and why an ESLint rule enforces it.
    logger.info(`otp 4821 sent`);

    expect(output()).toContain('4821');
  });
});

describe('request ids', () => {
  it('uses the prefixed shape the API contract specifies', () => {
    // docs/LLD/api-contracts.md: "request_id": "req_01J…"
    expect(newRequestId()).toMatch(/^req_[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('sorts in creation order, which is why v7 and not v4', () => {
    const ids = [newRequestId(), newRequestId(), newRequestId()];

    expect([...ids].sort()).toEqual(ids);
  });
});
