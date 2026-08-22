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

/**
 * Falls back to the schema's own defaults when the environment is incomplete, so that IMPORTING
 * this file cannot kill the process.
 *
 * The validation still happens and still fails loudly — but at `loadEnv()`, called explicitly
 * from the entrypoints. The difference matters for tests: a `process.exit(1)` at import turns a
 * missing MONGO_URI into a test runner that dies with no output, on a suite that never intended
 * to touch a database.
 */
type Env = z.infer<typeof schema>;

export const env: Env = parsed.success
  ? parsed.data
  : // The two required fields relaxed to empty, everything else at its schema default. Derived
    // from the schema rather than written out, so a new variable cannot be forgotten here.
    schema.extend({ MONGO_URI: z.string().default(''), REDIS_URL: z.string().default('') }).parse({});
export type { Env };

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * Validates the environment for real. Call once, first thing, from every entrypoint.
 *
 * A missing variable fails the process immediately with the variable named, rather than
 * surfacing as `undefined` inside a connection string an hour into a deploy.
 */
export function loadEnv(): Env {
  if (parsed.success) return parsed.data;

  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  // Not the logger: the logger reads LOG_LEVEL from this very object, so it may not exist yet.
  console.error(`Invalid environment:\n${issues}`);
  process.exit(1);
}
