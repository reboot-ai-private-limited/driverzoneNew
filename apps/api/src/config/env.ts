import 'dotenv/config';
import { z } from 'zod';

/**
 * Every environment variable the API reads, validated once at boot.
 *
 * Parsing here rather than reaching for `process.env` at the call site means a missing or
 * malformed variable fails the process on startup with a message naming the variable — instead
 * of surfacing as `undefined` inside a Mongo connection string an hour into a deploy, which is
 * where this class of bug normally shows up.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  /** Comma-separated list of allowed browser origins for the admin panel. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  /** Self-hosted OSRM. Road distance is required to match outstation bands (docs/04). */
  OSRM_BASE_URL: z.string().url().default('http://localhost:5000'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  // Not the logger: the logger reads LOG_LEVEL from this very object, so it may not exist yet.
  console.error(`Invalid environment:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
