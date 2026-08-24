import mongoose from 'mongoose';
import { isProduction, loadEnv } from '@/config/env.js';
import {
  DEV_ADMIN,
  DEV_CUSTOMER,
  DEV_CUSTOMER_EMPTY,
  DEV_DRIVER,
} from '@/config/devAccounts.js';
import { connectMongo, disconnectMongo } from '@/shared/db/mongo.js';
import { logger } from '@/shared/logging/logger.js';
import { AdminUserModel } from '@/modules/identity/infrastructure/adminUser.model.js';
import { CustomerModel } from '@/modules/identity/infrastructure/customer.model.js';
import { DriverModel } from '@/modules/identity/infrastructure/driver.model.js';
import { DriverDocumentModel } from '@/modules/identity/infrastructure/driverDocument.model.js';

/**
 * Creates the known development accounts: an admin, an approved driver, and two customers.
 *
 *   pnpm --filter @driverzone/api seed
 *
 * A fresh `docker compose down -v` leaves an empty database — no admin to log into the panel
 * with, no driver to dispatch to. Everyone recreated that by hand, differently, which made any
 * bug depending on the shape of the data impossible to reproduce across machines. The shape this
 * script produces was agreed in docs/setup-development.md before it was written.
 *
 * **The admin is the part that cannot be done any other way.** `account.repository.impl.ts`
 * deliberately throws for `create('ADMIN', …)` and there is no registration endpoint, so a
 * direct write is the sanctioned path rather than a shortcut around one.
 *
 * WHY MONGOOSE MODELS AND NOT THE MODULE CONTRACT. docs/setup-development.md asks seeds to go
 * through module public APIs, and that rule is right for zones: seeding a polygon through
 * `zones.public.ts` runs the `@driverzone/geo` invariants, so the seed cannot create geometry the
 * app itself could never produce. Identity has no cross-document invariant of that kind — unique
 * phone and a required admin name are single-document rules the schema and its indexes enforce
 * on any write, including this one. And `identity.public.ts` exposes no admin-creation method by
 * design. Please do not "fix" this by routing it through the contract.
 *
 * Idempotent: keyed on the fixed `_id`s in `devAccounts.ts`, so running it twice restores the
 * intended state rather than producing a second set of accounts.
 */

/** Coordinates in Siliguri, matching the zone examples used throughout the docs. */
const SEVOKE_ROAD = { lat: 26.7271, lng: 88.3953 };
const MATIGARA = { lat: 26.71, lng: 88.43 };

const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);

async function seedAdmin(): Promise<void> {
  await AdminUserModel.findOneAndUpdate(
    { _id: oid(DEV_ADMIN.id) },
    { $set: { phone: DEV_ADMIN.phone, fullName: DEV_ADMIN.fullName, isActive: true } },
    { upsert: true, new: true },
  ).exec();
}

async function seedDriver(): Promise<void> {
  await DriverModel.findOneAndUpdate(
    { _id: oid(DEV_DRIVER.id) },
    {
      $set: {
        phone: DEV_DRIVER.phone,
        fullName: DEV_DRIVER.fullName,
        dob: new Date('1988-07-04'),
        gender: 'MALE',
        experienceYears: 6,
        address: 'Matigara, Siliguri',
        vehicleTypePreference: 'MANUAL',
        vehicleCategoryPreference: ['SEDAN', 'SUV'],

        // Approved and verified, so a developer can go on duty immediately rather than walking
        // the onboarding flow every time the database is reset. `verifiedBy` points at the
        // seeded admin so the record is internally consistent — an approval with no approver
        // would be a state the app itself can never produce.
        onboardingStatus: 'APPROVED',
        isVerified: true,
        onboardingRejectionReason: null,
        verifiedBy: oid(DEV_ADMIN.id),
        verifiedAt: new Date('2026-08-24T00:00:00.000Z'),

        canDriveHill: true,
        canDriveHillVerified: true,
        isOnDuty: false,
        isBlocked: false,
      },
    },
    { upsert: true, new: true },
  ).exec();

  // Both documents the onboarding gate requires, already verified — consistent with a driver
  // whose application was approved.
  for (const docType of ['LICENCE', 'AADHAAR'] as const) {
    await DriverDocumentModel.findOneAndUpdate(
      { driverId: oid(DEV_DRIVER.id), docType },
      {
        $set: {
          fileUrl: `drivers/${DEV_DRIVER.id}/${docType.toLowerCase()}/seed`,
          status: 'VERIFIED',
          rejectionReason: null,
          verifiedBy: oid(DEV_ADMIN.id),
          verifiedAt: new Date('2026-08-24T00:00:00.000Z'),
          ...(docType === 'LICENCE'
            ? { number: 'WB7420110001234', subType: 'LMV-TR', expiresOn: new Date('2032-01-01') }
            : {}),
        },
      },
      { upsert: true, new: true },
    ).exec();
  }
}

async function seedCustomers(): Promise<void> {
  // The populated case: a customer who has used the app enough to have saved things.
  await CustomerModel.findOneAndUpdate(
    { _id: oid(DEV_CUSTOMER.id) },
    {
      $set: {
        phone: DEV_CUSTOMER.phone,
        fullName: DEV_CUSTOMER.fullName,
        dob: new Date('1994-03-12'),
        gender: 'FEMALE',
        languagesKnown: ['Bengali', 'Hindi', 'English'],
        alternatePhone: '+919812345678',
        emergencyContact: { name: 'Dev Contact', phone: '+919812340000' },

        // Two addresses with the flags deliberately SPLIT across them: default on one, preferred
        // pickup on the other. That is the case most likely to be broken by a change that treats
        // the two flags as one, and it should be visible the moment anyone opens the app.
        savedAddresses: [
          {
            entryId: 'adr_dev_home',
            label: 'HOME',
            address: '12 Sevoke Road, Siliguri',
            point: { type: 'Point', coordinates: [SEVOKE_ROAD.lng, SEVOKE_ROAD.lat] },
            isDefault: false,
            isPreferredPickup: true,
          },
          {
            entryId: 'adr_dev_office',
            label: 'OFFICE',
            address: 'Matigara, Siliguri',
            point: { type: 'Point', coordinates: [MATIGARA.lng, MATIGARA.lat] },
            isDefault: true,
            isPreferredPickup: false,
          },
        ],

        vehicles: [
          {
            entryId: 'veh_dev_sedan',
            category: 'SEDAN',
            plateNumber: 'WB74AB1234',
            fuelType: 'PETROL',
            isDefault: true,
          },
        ],

        isBlocked: false,
      },
    },
    { upsert: true, new: true },
  ).exec();

  /**
   * The empty case — phone number and nothing else, exactly what `otp/verify` leaves behind on a
   * first-ever login.
   *
   * `$setOnInsert` rather than `$set` for the profile fields, so that a developer who fills this
   * account in while testing does not have it silently wiped by the next seed run. The phone is
   * still `$set`, because that is the account's identity and must stay correct.
   */
  await CustomerModel.findOneAndUpdate(
    { _id: oid(DEV_CUSTOMER_EMPTY.id) },
    {
      $set: { phone: DEV_CUSTOMER_EMPTY.phone },
      $setOnInsert: {
        fullName: null,
        savedAddresses: [],
        vehicles: [],
        languagesKnown: [],
        isBlocked: false,
      },
    },
    { upsert: true, new: true },
  ).exec();
}

/**
 * Prints what was made.
 *
 * `console.log`, not the logger: this is a human reading a terminal, and a JSON line per row
 * would be worse than useless. Nobody should have to read this script to find out how to log in.
 */
function printSummary(fixedOtp: string | undefined): void {
  const rows = [
    ['ADMIN', DEV_ADMIN.phone, '/admin/auth', 'active'],
    ['DRIVER', DEV_DRIVER.phone, '/driver/auth', 'APPROVED, verified, off duty'],
    ['CUSTOMER', DEV_CUSTOMER.phone, '/customer/auth', '2 addresses, 1 vehicle'],
    ['CUSTOMER', DEV_CUSTOMER_EMPTY.phone, '/customer/auth', 'empty profile'],
  ];

  console.log('\n  Seeded accounts\n');
  console.log('  ROLE      PHONE           AUTH PATH        STATE');
  for (const [role, phone, path, state] of rows) {
    console.log(`  ${role?.padEnd(9)} ${phone?.padEnd(15)} ${path?.padEnd(16)} ${state}`);
  }

  console.log('');
  if (fixedOtp === undefined) {
    console.log('  DEV_FIXED_OTP is not set — POST otp/send, then read the code from the API log.');
    console.log('  Set it in apps/api/.env to skip that round trip for these four numbers.');
  } else {
    console.log(`  DEV_FIXED_OTP is set — POST otp/verify with "${fixedOtp}" directly.`);
    console.log('  No otp/send needed, and it works only for the four numbers above.');
  }
  console.log('');
}

async function main(): Promise<void> {
  const env = loadEnv();

  /**
   * Before anything is read or written.
   *
   * A seed script is a data-writing script wearing a friendly name, and the accounts it creates
   * have a fixed, published login. Running it against production would hand anyone who read this
   * file an administrator.
   */
  if (isProduction) {
    console.error('seed refuses to run with NODE_ENV=production — it creates known-credential accounts');
    process.exit(1);
  }

  await connectMongo();

  await seedAdmin();
  await seedDriver();
  await seedCustomers();

  logger.info({ accounts: 4 }, 'seed complete');
  printSummary(env.DEV_FIXED_OTP);

  await disconnectMongo();
}

main().catch((err: unknown) => {
  logger.fatal({ err: String(err) }, 'seed failed');
  process.exit(1);
});
