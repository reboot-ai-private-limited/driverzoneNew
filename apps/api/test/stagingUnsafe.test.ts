import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The staging escape hatch, proved to be shut by default.
 *
 * `STAGING_UNSAFE` opens four production guards at once (config/env.ts), the loudest consequence
 * being that the seeded accounts accept a published OTP. A flag like that is only as safe as its
 * default, and "it defaults to off" is exactly the kind of claim that stays true right up until
 * someone changes a zod default. So these tests assert the closed state as hard as the open one.
 *
 * Every case reloads the module graph. `isProduction` and `allowDevShortcuts` are module-level
 * constants computed from `process.env` at import time, so stubbing the environment after the
 * fact would prove nothing.
 */

/** The bare minimum that satisfies the schema, so `loadEnv` reaches the guards under test. */
const REQUIRED: Record<string, string> = {
  MONGO_URI: 'mongodb://localhost:27017/driverzone-test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  OTP_PEPPER: 'c'.repeat(48),
  PAYMENT_WEBHOOK_SECRET: 'd'.repeat(48),
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
};

/**
 * Reloads `config/env.ts` and the log sender against a synthetic environment.
 *
 * `DOTENV_CONFIG_PATH` is pointed at a file that does not exist on purpose: `env.ts` opens with
 * `import 'dotenv/config'`, which would otherwise read the developer's own `apps/api/.env` and
 * quietly supply a real `DEV_FIXED_OTP` to a case that depends on there being none.
 */
async function loadEnvModules(overrides: Record<string, string | undefined>) {
  vi.resetModules();

  const values: Record<string, string | undefined> = {
    ...REQUIRED,
    DOTENV_CONFIG_PATH: '/nonexistent/.env',
    DEV_FIXED_OTP: undefined,
    STAGING_UNSAFE: undefined,
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) {
    vi.stubEnv(key, value as string);
  }

  return {
    config: await import('../src/config/env.js'),
    otpSender: await import('../src/modules/identity/infrastructure/otpSender.log.js'),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('STAGING_UNSAFE — shut by default', () => {
  it('is off when the variable is absent', async () => {
    const { config } = await loadEnvModules({ NODE_ENV: 'production' });
    expect(config.allowDevShortcuts).toBe(false);
  });

  it('is off for any value other than the exact string "true"', async () => {
    // A zod `enum` rejects rather than coerces, so this must fail the schema outright — an
    // environment variable that half-enables a login bypass is the worst of the three outcomes.
    const { config } = await loadEnvModules({ NODE_ENV: 'production', STAGING_UNSAFE: '1' });
    expect(config.allowDevShortcuts).toBe(false);
  });

  it('refuses to start a production process carrying DEV_FIXED_OTP without it', async () => {
    const { config } = await loadEnvModules({ NODE_ENV: 'production', DEV_FIXED_OTP: '000000' });

    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('process.exit');
    }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => config.loadEnv()).toThrow('process.exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('makes the logging OTP sender a hard fault in production', async () => {
    const { otpSender } = await loadEnvModules({ NODE_ENV: 'production' });
    await expect(
      new otpSender.LoggingOtpSender().send('ADMIN', '+919000000001', '123456'),
    ).rejects.toThrow();
  });
});

describe('STAGING_UNSAFE — open', () => {
  it('lets a production process boot with DEV_FIXED_OTP set', async () => {
    const { config } = await loadEnvModules({
      NODE_ENV: 'production',
      DEV_FIXED_OTP: '000000',
      STAGING_UNSAFE: 'true',
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(config.loadEnv().DEV_FIXED_OTP).toBe('000000');
    expect(config.allowDevShortcuts).toBe(true);
  });

  it('shouts about it on every boot', async () => {
    const { config } = await loadEnvModules({
      NODE_ENV: 'production',
      DEV_FIXED_OTP: '000000',
      STAGING_UNSAFE: 'true',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    config.loadEnv();
    config.loadEnv();

    // Twice, not once: the failure mode this guards against is a staging env file outliving
    // staging, and a warning printed only on first boot is one nobody is left to read.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]?.[0])).toContain('STAGING_UNSAFE=true');
  });

  it('lets the logging OTP sender run in production', async () => {
    const { otpSender } = await loadEnvModules({ NODE_ENV: 'production', STAGING_UNSAFE: 'true' });
    await expect(
      new otpSender.LoggingOtpSender().send('ADMIN', '+919000000001', '123456'),
    ).resolves.toBeUndefined();
  });

  it('does not by itself create a bypass code', async () => {
    // Both halves are required. The flag opens the door; DEV_FIXED_OTP is what walks through it,
    // and identity.container.ts wires nothing without one.
    const { config } = await loadEnvModules({ NODE_ENV: 'production', STAGING_UNSAFE: 'true' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(config.loadEnv().DEV_FIXED_OTP).toBeUndefined();
  });
});
