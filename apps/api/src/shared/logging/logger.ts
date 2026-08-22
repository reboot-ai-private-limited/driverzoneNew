import winston from 'winston';
import { env, isProduction } from '@/config/env.js';
import { getRequestId } from '@/shared/http/request-context.js';

/**
 * Structured logs to stdout. Nothing writes log files — the container runtime owns collection,
 * and a process writing its own logs is a disk-full outage waiting for a busy day.
 */

/**
 * Stamps every line with the current request ID, pulled from the async context rather than
 * passed in.
 *
 * A format rather than a convention, because a convention is only as good as the last person
 * who remembered it — and the lines you most want correlated are the ones written in a hurry
 * inside a catch block. Outside a request (startup, shutdown, worker idle) there is no ID and
 * the field is omitted rather than set to a placeholder.
 */
const withRequestId = winston.format((info) => {
  const requestId = getRequestId();
  return requestId === undefined ? info : { ...info, requestId };
});

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: isProduction
    ? winston.format.combine(withRequestId(), winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
        withRequestId(),
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, requestId, ...rest }) => {
          // The ID is long and repeats on every line of a request; the first segment is enough
          // to group them by eye, and the full value is in the response header when you need to
          // grep for it.
          const id = typeof requestId === 'string' ? ` [${requestId.slice(0, 8)}]` : '';
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
          return `${String(timestamp)}${id} ${level} ${String(message)}${extra}`;
        }),
      ),
  transports: [new winston.transports.Console()],
});
