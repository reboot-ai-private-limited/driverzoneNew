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

  /** pino's six, ordered by severity. See docs/engineering/coding-standards.md §Logging. */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Self-hosted OSRM. Road distance is required to match outstation bands (docs/LLD/zone-resolution.md). */
  OSRM_BASE_URL: z.string().url().default('http://localhost:5000'),

  /**
   * Token signing secrets — SEPARATE, and that is the point (docs/decision-log.md, 2026-08-24).
   * A leaked access secret must not also forge refresh tokens: the two have very different
   * blast radii, 15 minutes against up to 30 days.
   *
   * 32 characters minimum so a placeholder like "secret" fails at boot rather than shipping.
   * Generate with `openssl rand -base64 48`.
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),

  /**
   * Keys the HMAC that login OTPs are stored under. Not a password-grade hash, deliberately —
   * see docs/decision-log.md, 2026-08-24. A leak devalues only in-flight challenges (5 minutes),
   * never a long-lived credential.
   */
  OTP_PEPPER: z.string().min(32, 'OTP_PEPPER must be at least 32 characters'),

  /**
   * THE STAGING ESCAPE HATCH. Off unless set to exactly `true`, and it opens four doors at once.
   *
   * A staging deployment is a production BUILD that nobody can log into: `LoggingOtpSender` is
   * the only sender that exists and it refuses to run in production, so `otp/send` 500s and the
   * login screen never reaches its code field. The choice is this flag or running staging as
   * `NODE_ENV=development`, which would also silently drop the Secure flag from the refresh
   * cookie, put stack traces and client IPs in error bodies, serve `/docs` to the internet, and
   * re-enable the mock payment gateway. This keeps all of that production-correct and moves only
   * the four guards named below.
   *
   * What it opens — nothing else consults it:
   *   1. `loadEnv()` accepts `DEV_FIXED_OTP` in production instead of exiting.
   *   2. `identity.container.ts` wires the fixed-OTP bypass for the seeded numbers.
   *   3. `otpSender.log.ts` writes login codes to the log instead of refusing.
   *   4. `scripts/seed.ts` runs, creating accounts with a published login.
   *
   * TOGETHER those mean anyone who can read this repository can sign in as the seeded admin.
   * It belongs on a throwaway staging host and nowhere else. `loadEnv()` says so on every boot.
   */
  STAGING_UNSAFE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  /**
   * A fixed OTP accepted for the seeded accounts in `devAccounts.ts` — development, or staging
   * with `STAGING_UNSAFE`.
   *
   * Unset by default, and it takes three independent conditions to do anything: this variable
   * set, the number on the seed allowlist, and either `NODE_ENV` not production or the escape
   * hatch above. `loadEnv()` below refuses to start a production process that has this set
   * WITHOUT the escape hatch, so a value leaking into a real prod env file kills the process
   * instead of quietly opening a login.
   *
   * Any other number still gets a real random code, so the generation, hashing and
   * attempt-burning paths stay exercised locally.
   */
  DEV_FIXED_OTP: z
    .string()
    .regex(/^\d{6}$/, 'DEV_FIXED_OTP must be exactly 6 digits')
    .optional(),

  /**
   * Cloudinary credentials for media storage (driver documents, profile pictures).
   */
  /**
   * Path to the Firebase Admin service-account JSON. UNSET is a supported state: the app falls
   * back to `MockPushSender`, which logs every ring instead of delivering it — so a developer
   * without credentials still gets a working booking flow.
   */
  FCM_SERVICE_ACCOUNT_PATH: z.string().optional(),

  /**
   * wabridge.com — the WhatsApp channel that delivers login OTPs in production.
   *
   * All OPTIONAL here, because development, test and staging never touch it: they print the code
   * to the log (`LoggingOtpSender`). A real production process that lacks these does not silently
   * degrade — `WhatsAppOtpSender` throws at construction naming the missing variable, so the
   * process fails to boot rather than 500ing on the first login.
   *
   * `WA_TEMPLATE_ID` is an APPROVED WhatsApp template whose one variable is the code — a
   * business-initiated message to a user outside a 24h session window must be a template, so a
   * plain-text body is not an option here.
   */
  WA_API_URL: z.string().url().default('https://web.wabridge.com/api/createmessage'),
  WA_APP_KEY: z.string().min(1).optional(),
  WA_AUTH_KEY: z.string().min(1).optional(),
  WA_DEVICE_ID: z.string().min(1).optional(),
  WA_TEMPLATE_ID: z.string().min(1).optional(),

  /**
   * The `{{2}}` placeholder in the OTP template — a contact number shown to the user ("call this
   * number if you did not request a code"). The template has TWO variables; sending only the
   * code makes wabridge return success while WhatsApp silently drops the message. Defaulted so an
   * unset value cannot reintroduce that failure.
   */
  WA_OTP_CONTACT_NUMBER: z.string().min(1).default('7044076603'),

  CLOUDINARY_CLOUD_NAME: z.string().min(1, 'CLOUDINARY_CLOUD_NAME is required'),
  CLOUDINARY_API_KEY: z.string().min(1, 'CLOUDINARY_API_KEY is required'),
  CLOUDINARY_API_SECRET: z.string().min(1, 'CLOUDINARY_API_SECRET is required'),

  /**
   * Signs the payment gateway's webhooks. The mock gateway signs with it too, so the signature
   * path is exercised locally rather than bypassed and discovered broken against the real one.
   *
   * A webhook is an unauthenticated public endpoint that moves a booking to CONFIRMED — the
   * signature is the ONLY thing standing between the internet and a free ride, which is why this
   * has the same 32-character floor as the token secrets.
   */
  PAYMENT_WEBHOOK_SECRET: z
    .string()
    .min(32, 'PAYMENT_WEBHOOK_SECRET must be at least 32 characters'),

  /**
   * Razorpay. The key id is PUBLISHABLE — it is sent to the app beside the order id — while the
   * secret signs checkout callbacks and authenticates our API calls. They are separate variables
   * because they have separate blast radii, exactly like the two JWT secrets.
   *
   * Test-mode keys are `rzp_test_…`. Absent, the container falls back to the mock gateway, which
   * refuses to run in production — so a production deploy missing these fails at boot rather than
   * confirming bookings that collected nothing.
   */
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  /**
   * Signs Razorpay's webhooks, and is NOT the key secret — a different secret over a different
   * message. Set on the webhook itself in the Razorpay dashboard.
   *
   * Rotating it invalidates in-flight retries: Razorpay's own guidance is to validate older
   * deliveries with the previous secret for a while after a rotation.
   */
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  /**
   * Whether the mock gateway captures automatically. Off is how the pending-then-webhook path is
   * exercised; on is the fast path for walking the booking flow by hand. Ignored in production,
   * where the mock gateway refuses to run at all.
   */
  MOCK_PAYMENT_AUTO_CAPTURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /** Maximum allowed file size for uploads in megabytes. Default: 3MB. */
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(3),

  /** Comma-separated list of allowed file formats for uploads. */
  UPLOAD_ALLOWED_FORMATS: z
    .string()
    .default('jpg,png,webp')
    .transform((s) => s.split(',').map((o) => o.trim().toLowerCase()).filter(Boolean)),
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
  : // Every required field relaxed to a harmless value, everything else at its schema default.
    // Derived from the schema rather than written out, so a new variable cannot be forgotten
    // here. The secrets get throwaway values long enough to satisfy their own min(32) — they
    // are never reachable at runtime, because `loadEnv()` has already exited the process by
    // then; this branch exists only so that IMPORTING this file in a test cannot kill it.
    schema
      .extend({
        MONGO_URI: z.string().default(''),
        REDIS_URL: z.string().default(''),
        JWT_ACCESS_SECRET: z.string().default('test-only-access-secret-not-for-any-real-use'),
        JWT_REFRESH_SECRET: z.string().default('test-only-refresh-secret-not-for-any-real-use'),
        OTP_PEPPER: z.string().default('test-only-otp-pepper-not-for-any-real-use-x'),
        PAYMENT_WEBHOOK_SECRET: z.string().default('test-only-webhook-secret-not-for-any-real-use'),
        CLOUDINARY_CLOUD_NAME: z.string().default('test-cloud'),
        CLOUDINARY_API_KEY: z.string().default('test-key'),
        CLOUDINARY_API_SECRET: z.string().default('test-secret'),
      })
      .parse({});
export type { Env };

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/**
 * The single expression every relaxed guard consults, so "what does staging open" is answered by
 * grepping one identifier rather than auditing four modules.
 *
 * Deliberately NOT folded into `isProduction`. The guards read `isProduction && !allowDevShortcuts`
 * so that both halves stay visible at the point of use — a reader who sees only `isProduction`
 * there would have to know that it secretly meant something else in staging.
 */
export const allowDevShortcuts = env.STAGING_UNSAFE;

/**
 * Validates the environment for real. Call once, first thing, from every entrypoint.
 *
 * A missing variable fails the process immediately with the variable named, rather than
 * surfacing as `undefined` inside a connection string an hour into a deploy.
 */
export function loadEnv(): Env {
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    // Not the logger: the logger reads LOG_LEVEL from this very object, so it may not exist yet.
    console.error(`Invalid environment:\n${issues}`);
    process.exit(1);
  }

  /**
   * A login bypass must never reach production BY ACCIDENT, and the container already refuses to
   * wire it there. This is the second, louder lock: a production environment carrying
   * `DEV_FIXED_OTP` without having explicitly asked for the staging escape hatch does not start.
   *
   * Failing here rather than ignoring the value is the whole point — a silently-ignored bypass
   * variable in a prod env file is a landmine for whoever later "fixes" the code that ignores it.
   */
  if (
    parsed.data.NODE_ENV === 'production' &&
    parsed.data.DEV_FIXED_OTP !== undefined &&
    !parsed.data.STAGING_UNSAFE
  ) {
    console.error(
      'Invalid environment:\n  DEV_FIXED_OTP: must not be set when NODE_ENV=production — ' +
        'it is a login bypass. Set STAGING_UNSAFE=true as well if this really is a ' +
        'throwaway staging host.',
    );
    process.exit(1);
  }

  /**
   * Said on EVERY boot, not once at deploy time, because the whole failure mode this guards
   * against is a staging env file quietly outliving staging. Not the logger: it reads LOG_LEVEL
   * off this very object, and this must be impossible to filter out with LOG_LEVEL anyway.
   */
  if (parsed.data.NODE_ENV === 'production' && parsed.data.STAGING_UNSAFE) {
    console.warn(
      [
        '',
        '  ┌─ STAGING_UNSAFE=true ─────────────────────────────────────────────────────┐',
        '  │ This production build is running with its login guards open:              │',
        '  │   • the seeded accounts accept a fixed OTP (DEV_FIXED_OTP)                │',
        '  │   • login codes are written to the log, not sent by SMS                   │',
        '  │   • the seed script will run, creating known-credential accounts          │',
        '  │ Anyone who can read the repository can sign in as the seeded admin.       │',
        '  │ Correct for a throwaway staging host. NEVER for a real deployment.        │',
        '  └───────────────────────────────────────────────────────────────────────────┘',
        '',
      ].join('\n'),
    );
  }

  return parsed.data;
}
