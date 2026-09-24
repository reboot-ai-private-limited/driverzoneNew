import { loadEnv } from '@/config/env.js';
import { DEV_ACCOUNTS } from '@/config/devAccounts.js';
import { DEV_ZONES } from '@/config/devZones.js';
import { seedZones } from '@/scripts/seedZones.js';
import { connectMongo, disconnectMongo } from '@/shared/db/mongo.js';
import { logger } from '@/shared/logging/logger.js';
import { buildZonesContainer } from '@/modules/zones/zones.container.js';
import { AdminUserModel } from '@/modules/identity/infrastructure/adminUser.model.js';

/**
 * Prepares a PRODUCTION database: one real super-admin and the starter zones. Nothing else — no
 * drivers, no customers, no demo booking, no reviews.
 *
 *   ADMIN_PHONE=+919876543210 ADMIN_NAME="Jane Doe" pnpm --filter @driverzone/api bootstrap
 *   docker compose -f docker-compose.prod.yml run --rm \
 *     -e ADMIN_PHONE=+919876543210 -e ADMIN_NAME="Jane Doe" bootstrap
 *
 * WHY THIS RUNS WITHOUT `STAGING_UNSAFE`, when `seed.ts` refuses to. `seed.ts` is dangerous because
 * its accounts have a login committed to this repository. Here the operator supplies the number at
 * run time, it appears nowhere in the code, and signing in still needs a real OTP delivered to that
 * phone. The dev numbers are refused outright so this cannot quietly recreate the demo admin.
 *
 * The admin is written through the model directly for the reason `seed.ts`'s header gives: identity
 * has no admin-creation path by design. Zones go through `zones.public.ts` via `seedZones`, so the
 * geo invariants run on them.
 *
 * Idempotent: the admin is keyed on phone, zones on `code`. Rerunning renames the admin and
 * re-activates it, and leaves every existing zone — including ones reshaped in the editor — alone.
 */

/** The same E.164 rule `otp/send` enforces (identity.validation.ts), so the admin can actually log in. */
const E164 = /^\+[1-9]\d{7,14}$/;

function fail(message: string): never {
  console.error(`bootstrap: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  loadEnv();

  const phone = process.env.ADMIN_PHONE?.trim() ?? '';
  const fullName = process.env.ADMIN_NAME?.trim() ?? '';

  if (!phone) fail('ADMIN_PHONE is required, in international format, e.g. +919876543210.');
  if (!E164.test(phone)) fail(`ADMIN_PHONE "${phone}" is not E.164 — use e.g. +919876543210, no spaces.`);
  if (!fullName) fail('ADMIN_NAME is required.');
  if (DEV_ACCOUNTS.some((a) => a.phone === phone)) {
    fail(`${phone} is a seeded development number (devAccounts.ts). Use a real phone.`);
  }

  await connectMongo();

  const admin = await AdminUserModel.findOneAndUpdate(
    { phone },
    { $set: { fullName, isActive: true, adminRole: 'SUPER_ADMIN' } },
    { upsert: true, new: true },
  ).exec();

  const zoneOutcome = await seedZones(buildZonesContainer().contract, admin._id.toString());

  logger.info(
    { adminId: admin._id.toString(), zonesCreated: [...zoneOutcome.values()].filter((o) => o === 'created').length },
    'bootstrap complete',
  );

  console.log('\n  Admin\n');
  console.log(`  SUPER_ADMIN  ${phone}  ${fullName}  (${admin._id.toString()})`);
  console.log('\n  Zones\n');
  for (const zone of DEV_ZONES) {
    const state = zoneOutcome.get(zone.code) === 'present' ? 'already present' : 'created';
    console.log(`  ${zone.type.padEnd(9)} ${zone.code.padEnd(15)} ${zone.name.padEnd(21)} ${state}`);
  }
  console.log('\n  Log into the admin panel with this number; the OTP arrives over WhatsApp.\n');

  await disconnectMongo();
}

main().catch((err: unknown) => {
  logger.fatal({ err: String(err) }, 'bootstrap failed');
  process.exit(1);
});
