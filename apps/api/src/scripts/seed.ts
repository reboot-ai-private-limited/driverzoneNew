import mongoose from 'mongoose';
import { isProduction, loadEnv } from '@/config/env.js';
import {
  DEV_ACCOUNTS,
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
import { SessionModel } from '@/modules/identity/infrastructure/session.model.js';
import { AuditLogModel } from '@/shared/db/auditLog.model.js';

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

/**
 * Just the capability `--reset` needs.
 *
 * A union of differently-typed `Model<T>`s has overloaded call signatures TypeScript cannot
 * reconcile, so calling `.deleteMany` across the list is an error even though every member accepts
 * the identical argument (the same limitation worked around in `account.repository.impl.ts`).
 * Naming the one method keeps the models themselves referenced, so deleting a model is still a
 * compile error here rather than a collection quietly surviving the reset.
 */
interface ClearableModel {
  deleteMany(filter: Record<string, never>): { exec(): Promise<{ deletedCount: number }> };
}

/** Every Mongoose model the `identity` module owns, in the order `--reset` clears them. */
const IDENTITY_MODELS: { name: string; model: ClearableModel }[] = [
  { name: 'sessions', model: SessionModel },
  { name: 'auditlogs', model: AuditLogModel },
  { name: 'driverdocuments', model: DriverDocumentModel },
  { name: 'drivers', model: DriverModel },
  { name: 'customers', model: CustomerModel },
  { name: 'adminusers', model: AdminUserModel },
];

/** The four documents this script owns. Anything else in these collections came from elsewhere. */
const SEEDED_IDS = DEV_ACCOUNTS.map((a) => oid(a.id));

/**
 * `--reset`: clear what `identity` owns, then reseed.
 *
 * Collection-by-collection rather than `dropDatabase()`, deliberately. When `zones`, `catalog`
 * and `bookings` land they will own collections this script knows nothing about, and a blanket
 * drop would destroy them silently. Each module's seed should extend `IDENTITY_MODELS` with its
 * own — a list that has to be maintained is the point, not an oversight.
 *
 * Sessions and audit rows go first: they reference accounts, so clearing them in this order never
 * leaves a row pointing at something that no longer exists, even if the script dies midway.
 */
async function resetIdentityCollections(): Promise<void> {
  console.log('\n  Clearing identity collections (--reset)\n');

  for (const { name, model } of IDENTITY_MODELS) {
    const { deletedCount } = await model.deleteMany({}).exec();
    console.log(`  ${name.padEnd(16)} ${deletedCount} removed`);
  }
}

/**
 * Counts identity records this script did not create.
 *
 * Exists because their absence from the summary was confusing: a run reports "4 accounts" while
 * the database holds eight, and nothing explains the gap. Left alone rather than removed — an
 * additive seed must not delete an account somebody is mid-way through testing with.
 */
async function countForeignAccounts(): Promise<{ customers: number; drivers: number; admins: number }> {
  const notSeeded = { _id: { $nin: SEEDED_IDS } };
  const [customers, drivers, admins] = await Promise.all([
    CustomerModel.countDocuments(notSeeded).exec(),
    DriverModel.countDocuments(notSeeded).exec(),
    AdminUserModel.countDocuments(notSeeded).exec(),
  ]);
  return { customers, drivers, admins };
}

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
function printSummary(
  fixedOtp: string | undefined,
  foreign: { customers: number; drivers: number; admins: number },
): void {
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

  /**
   * Accounts this run did not create.
   *
   * Reported because their absence from the table above is genuinely confusing — the summary says
   * four while the database holds more, and nothing explains why. Almost always leftovers from
   * manual testing, which is exactly what `--reset` is for.
   */
  const otherTotal = foreign.customers + foreign.drivers + foreign.admins;
  if (otherTotal > 0) {
    const parts = [
      foreign.customers > 0 ? `${foreign.customers} customer${foreign.customers > 1 ? 's' : ''}` : '',
      foreign.drivers > 0 ? `${foreign.drivers} driver${foreign.drivers > 1 ? 's' : ''}` : '',
      foreign.admins > 0 ? `${foreign.admins} admin${foreign.admins > 1 ? 's' : ''}` : '',
    ].filter(Boolean);

    console.log('');
    console.log(`  Note: ${otherTotal} other account(s) this seed did not create (${parts.join(', ')}).`);
    console.log('        Left untouched. `pnpm seed --reset` clears them and reseeds.');
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

  /**
   * `--reset` is destructive, so it sits BEHIND the production guard above rather than beside it.
   * The dangerous path must not be the one with the shorter route past the check.
   */
  const reset = process.argv.includes('--reset');

  await connectMongo();

  if (reset) await resetIdentityCollections();

  await seedAdmin();
  await seedDriver();
  await seedCustomers();

  const foreign = await countForeignAccounts();

  logger.info({ accounts: 4, reset }, 'seed complete');
  printSummary(env.DEV_FIXED_OTP, foreign);

  await disconnectMongo();
}

main().catch((err: unknown) => {
  logger.fatal({ err: String(err) }, 'seed failed');
  process.exit(1);
});
