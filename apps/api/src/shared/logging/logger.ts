import pino from 'pino';
import { env, isProduction } from '@/config/env.js';
import { getRequestId } from '@/shared/http/request-context.js';

/**
 * Structured logs to stdout. Nothing writes log files — the container runtime owns collection,
 * and a process writing its own logs is a disk-full outage waiting for a busy day.
 *
 * pino rather than winston, and the reason is `redact` below rather than throughput. This
 * system handles trip-start OTPs, phone numbers and bearer tokens; winston has no redaction, so
 * under it every one of those rules would be a custom format we wrote and maintained. See
 * docs/decision-log.md.
 *
 * NOTE THE ARGUMENT ORDER: `logger.info({ data }, 'message')`. It is the reverse of winston's
 * `logger.info('message', { data })`, and getting it backwards is not an error — pino logs the
 * object as the message and silently drops every field.
 */

/**
 * Fields that must never reach a log, whatever wraps them.
 *
 * Names come from the payloads in docs/LLD/api-contracts.md rather than from imagination,
 * so this list tracks the real API surface. `*.x` covers one level of nesting, which is where
 * these actually appear — inside `booking`, `customer`, `driver`, `req.body`.
 *
 * Coordinates are deliberately absent. A lat/lng is what you debug dispatch with, and a single
 * point in one line is a different exposure from a stored trace. The rule that replaces
 * redaction here: never log a route or a trace whole — log the zone ID it resolved to.
 */
const REDACTED_PATHS = [
  // Trip-start bypass. An OTP in a log is a driver starting a trip they never arrived for.
  'otp',
  'start_otp',
  '*.otp',
  '*.start_otp',

  // Phone+OTP is the auth mechanism, and masked_phone exists precisely so neither party sees
  // the other's real number. Logging either defeats the point.
  'phone',
  'masked_phone',
  '*.phone',
  '*.masked_phone',

  // Credentials.
  'token',
  'password',
  'refresh_token',
  '*.token',
  '*.password',
  '*.refresh_token',
  'req.headers.authorization',
  'headers.authorization',

  // Identifies the payment attempt this request belongs to.
  'req.headers["idempotency-key"]',
  'headers["idempotency-key"]',

  // Identifies a person.
  'address',
  'customer_car_plate',
  '*.address',
  '*.customer_car_plate',
];

export const logger = pino({
  level: env.LOG_LEVEL,

  redact: {
    paths: REDACTED_PATHS,
    censor: '[redacted]',
  },

  /**
   * Stamps every line with the current request ID, read from the async context rather than
   * passed in.
   *
   * A mixin rather than a convention, because a convention is only as good as the last person
   * who remembered it — and the lines you most want correlated are written in a hurry inside a
   * catch block. Outside a request (startup, shutdown, worker idle) there is no ID and the
   * field is omitted rather than set to a placeholder.
   */
  mixin() {
    const requestId = getRequestId();
    return requestId === undefined ? {} : { requestId };
  },

  formatters: {
    // `level: "info"` rather than pino's default `level: 30`. Numeric levels are smaller on the
    // wire and unreadable in every log viewer, which is the wrong trade for a system whose logs
    // are read by people far more often than they are parsed by machines.
    level: (label) => ({ level: label }),
  },

  // ISO-8601 rather than epoch millis, for the same reason.
  timestamp: pino.stdTimeFunctions.isoTime,

  // Human-readable in development, JSON in production — from one config, which was the one
  // thing worth keeping from the winston setup.
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            messageFormat: '{if requestId}[{requestId}] {end}{msg}',
          },
        },
      }),
});
