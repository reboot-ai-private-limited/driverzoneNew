import winston from 'winston';
import { env, isProduction } from '@/config/env.js';

/**
 * Structured logs to stdout. Nothing writes log files — the container runtime owns collection,
 * and a process writing its own logs is a disk-full outage waiting for a busy day.
 */
export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: isProduction
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, ...rest }) => {
          const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
          return `${String(timestamp)} ${level} ${String(message)}${extra}`;
        }),
      ),
  transports: [new winston.transports.Console()],
});
