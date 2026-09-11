import mongoose from 'mongoose';
import { allowDevShortcuts, isProduction, loadEnv } from '@/config/env.js';
import {
  DEMO_BOOKING,
  DEV_ACCOUNTS,
  DEV_ADMIN,
  DEV_CUSTOMER,
  DEV_CUSTOMER_EMPTY,
  DEV_DRIVER,
  DEV_DRIVER_TWO,
  type DevAccount,
} from '@/config/devAccounts.js';
import { DEV_ZONES } from '@/config/devZones.js';
import { connectMongo, disconnectMongo } from '@/shared/db/mongo.js';
import { logger } from '@/shared/logging/logger.js';
import { buildZonesContainer } from '@/modules/zones/zones.container.js';
import type { ZonesPublicContract } from '@/modules/zones/zones.public.js';
import { AdminUserModel } from '@/modules/identity/infrastructure/adminUser.model.js';
import { CustomerModel } from '@/modules/identity/infrastructure/customer.model.js';
import { DriverModel } from '@/modules/identity/infrastructure/driver.model.js';
import { DriverDocumentModel } from '@/modules/identity/infrastructure/driverDocument.model.js';
import { SessionModel } from '@/modules/identity/infrastructure/session.model.js';
import { ReviewModel } from '@/modules/reviews/infrastructure/review.model.js';
import { AuditLogModel } from '@/shared/db/auditLog.model.js';
import { BookingModel } from '@/modules/bookings/infrastructure/booking.model.js';

/**
 * Creates the known development accounts — an admin, an approved driver, two customers — and the
 * known zones: Siliguri, its three pickup areas, and the two hill districts above it.
 *
 *   pnpm --filter @driverzone/api seed
 *
 * A fresh `docker compose down -v` leaves an empty database — no admin to log into the panel
 * with, no driver to dispatch to. Everyone recreated that by hand, differently, which made any
 * bug depending on the shape of the data impossible to reproduce across machines. The shape this
 * script produces was agreed in docs/setup-development.md before it was written.
 *
 * THE TWO HALVES GO THROUGH DIFFERENT DOORS, ON PURPOSE.
 *
 * Zones go through `zones.public.ts`, as docs/setup-development.md asks: that runs the
 * `@driverzone/geo` invariants on every polygon, so the seed cannot create geometry the app
 * itself could never produce. It costs id determinism — `create()` takes no `_id`, so zone ids
 * differ between machines and `code` is the stable handle instead. `devZones.ts` explains why
 * that is the right way round.
 *
 * Identity goes through the Mongoose models directly. It has no cross-document invariant of the
 * kind zones have — unique phone and a required admin name are single-document rules the schema
 * and its indexes enforce on any write, including this one — and `identity.public.ts` exposes no
 * admin-creation method BY DESIGN: `account.repository.impl.ts` deliberately throws for
 * `create('ADMIN', …)` and there is no registration endpoint, so a direct write is the sanctioned
 * path rather than a shortcut around one. Please do not "fix" this by routing it through the
 * contract; there is nothing to route it through.
 *
 * Idempotent, by different keys for the same reason: accounts on the fixed `_id`s in
 * `devAccounts.ts`, zones on `code` (unique among active zones by index). Running it twice
 * restores the intended state rather than producing a second set of either.
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
  { name: 'reviews', model: ReviewModel as unknown as ClearableModel },
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
 * Collection-by-collection rather than `dropDatabase()`, deliberately. When `packages` and
 * `bookings` land they will own collections this script knows nothing about, and a blanket drop
 * would destroy them silently. Each module's seed should extend `IDENTITY_MODELS` with its own,
 * or clear itself through its own contract the way `resetZones` below does — a list that has to
 * be maintained is the point, not an oversight.
 *
 * Sessions and audit rows go first: they reference accounts, so clearing them in this order never
 * leaves a row pointing at something that no longer exists, even if the script dies midway.
 */
async function resetIdentityCollections(): Promise<void> {
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

/**
 * One approved, verified driver.
 *
 * TAKES THE ACCOUNT rather than closing over `DEV_DRIVER`, because there are two of them now and
 * a second copy of this function is how the two would drift into having different competencies —
 * at which point "the seeded drivers" stops being one known shape.
 */
async function seedDriver(account: DevAccount, options: { isOnDuty: boolean }): Promise<void> {
  await DriverModel.findOneAndUpdate(
    { _id: oid(account.id) },
    {
      $set: {
        phone: account.phone,
        fullName: account.fullName,
        dob: new Date('1988-07-04'),
        gender: 'MALE',
        experienceYears: 6,
        address: 'Matigara, Siliguri',
        /*
         * Broad on purpose. An empty preference means NO OFFERS, so a narrowly-declared dev
         * driver would silently fail to ring for most test bookings and look like broken
         * dispatch. Every category and every transmission keeps the seeded driver a constant.
         */
        vehicleTypePreferences: ['AUTO', 'MANUAL', 'EV'],
        vehicleCategoryPreference: ['MINI', 'HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'],

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
        isOnDuty: options.isOnDuty,
        isBlocked: false,
      },
    },
    { upsert: true, new: true },
  ).exec();

  // Every document the onboarding gate requires — BOTH SIDES of each — already verified,
  // consistent with a driver whose application was approved.
  for (const { docType, side } of [
    { docType: 'LICENCE', side: 'FRONT' },
    { docType: 'LICENCE', side: 'BACK' },
    { docType: 'GOVERNMENT_ID', side: 'FRONT' },
    { docType: 'GOVERNMENT_ID', side: 'BACK' },
  ] as const) {
    await DriverDocumentModel.findOneAndUpdate(
      { driverId: oid(account.id), docType, side },
      {
        $set: {
          fileUrl: `drivers/${account.id}/${docType.toLowerCase()}-${side.toLowerCase()}/seed`,
          status: 'VERIFIED',
          rejectionReason: null,
          verifiedBy: oid(DEV_ADMIN.id),
          verifiedAt: new Date('2026-08-24T00:00:00.000Z'),
          ...(docType === 'LICENCE'
            ? { number: 'WB7420110001234', subType: 'LMV,LMV-NT', expiresOn: new Date('2032-01-01') }
            : { number: '400012345678', subType: 'AADHAAR' }),
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
 * Three reviews against the dev accounts, so the admin ledger and both profile screens have
 * something to render before anyone has taken a trip.
 *
 * The booking ids are FIXED rather than freshly generated, which is what makes this idempotent:
 * generated ones made the delete below a no-op and every run appended another three rows. They
 * point at no real booking — this script seeds no bookings — and nothing reads through them; the
 * admin list renders the id as a string.
 *
 * The cached averages are written to match. Publishing a review without updating the cache is a
 * state the app itself cannot reach (`PublishReviewsUseCase` does both), and a seed that produces
 * one has the driver showing 5.0 from zero ratings next to three visible reviews.
 */
const SEEDED_REVIEW_BOOKINGS = [
  oid('000000000000000000000ba1'),
  oid('000000000000000000000ba2'),
  oid('000000000000000000000ba3'),
];

async function seedReviews(): Promise<void> {
  const customerId = oid(DEV_CUSTOMER.id);
  const driverId = oid(DEV_DRIVER.id);
  const [booking1, booking2, booking3] = SEEDED_REVIEW_BOOKINGS;

  await ReviewModel.deleteMany({ bookingId: { $in: SEEDED_REVIEW_BOOKINGS } }).exec();

  await ReviewModel.create([
    {
      bookingId: booking1,
      reviewerId: customerId,
      reviewerRole: 'CUSTOMER',
      revieweeId: driverId,
      revieweeRole: 'DRIVER',
      rating: 5,
      tags: ['Polite', 'Clean Car'],
      comment: 'Great trip, very smooth driving!',
      isPublished: true,
    },
    {
      bookingId: booking2,
      reviewerId: driverId,
      reviewerRole: 'DRIVER',
      revieweeId: customerId,
      revieweeRole: 'CUSTOMER',
      rating: 4,
      tags: ['On Time'],
      comment: 'Customer was ready at pickup.',
      isPublished: true,
    },
    // Flagged automatically by the 1-2 star rule, so the ops filter has a row to find.
    {
      bookingId: booking3,
      reviewerId: customerId,
      reviewerRole: 'CUSTOMER',
      revieweeId: driverId,
      revieweeRole: 'DRIVER',
      rating: 2,
      tags: ['Late', 'AC Issue'],
      comment: 'Driver was 15 minutes late and AC barely worked.',
      adminFlagged: true,
      isPublished: true,
    },
  ]);

  // The driver has two (5 and 2); the customer has one (4).
  await DriverModel.updateOne({ _id: driverId }, { $set: { rating: 3.5, ratingCount: 2 } }).exec();
  await CustomerModel.updateOne({ _id: customerId }, { $set: { rating: 4, ratingCount: 1 } }).exec();
}

/**
 * Creates the zones in `devZones.ts` that are not already there.
 *
 * Through the contract, so `normalizeWinding` and every `@driverzone/geo` rule run on the way in
 * — a fixture that overlaps a sibling fails the seed instead of landing in the database as
 * geometry the admin panel would have refused. Runs AFTER `seedAdmin()`: every zone's `createdBy`
 * points at the seeded admin, and an approval with no approver is a state the app cannot produce.
 *
 * SKIP, NOT UPSERT, when the code is already active. Changing a zone's geometry is
 * `updateGeometry` with an `expectedVersion` — a versioned edit that supersedes the old document
 * — and doing that silently to a zone somebody is mid-way through editing is worse than leaving
 * it alone and saying so. `--reset` is how you force the fixture back.
 *
 * Returns what happened per zone, for the summary.
 */
/**
 * A booking parked at `ASSIGNED` on `DEV_DRIVER`, so the panel's ops actions have something to
 * act on the moment the database is seeded.
 *
 * WRITTEN STRAIGHT TO THE MODEL, like the identity accounts above and unlike the zones. There is
 * no door to go through: `bookings.public.ts` exposes `beginSearching` and `claimForDriver` and
 * deliberately nothing that CREATES a booking, because in the real system one only ever comes
 * into existence from a paid quote. Reproducing that here would mean seeding a quote, a payment
 * and a dispatch wave — five moving parts, none of which is what a developer testing a driver
 * transfer is trying to exercise.
 *
 * WHAT THIS IS NOT. It is a fixture, not a real trip: the `quoteId` points at no quote, and the
 * fare snapshot below was written by hand rather than by `computeFare`. Nothing reads either back
 * — a transfer touches `driverId` and `status`, and a cancellation touches the payment, which
 * this booking does not have. Do not grow it into a substitute for the real booking flow; if a
 * test needs a genuinely priced trip, it needs the app.
 *
 * NO EVENT ROW is written for it either. `bookingEvents` is the product's memory of what actually
 * happened, and inventing a history for a booking that never happened would put fiction in the one
 * collection whose value is that it contains none. The panel's timeline shows nothing until an
 * admin does something real to it — which is the point of seeding it.
 *
 * Idempotent on the fixed `_id`, like everything else here. Re-running the seed RESTORES it to
 * `ASSIGNED` on `DEV_DRIVER`, which is what makes it re-testable: transfer it away, run the seed,
 * transfer it again.
 */
async function seedDemoBooking(): Promise<void> {
  const scheduledAt = new Date();

  await BookingModel.findOneAndUpdate(
    { _id: oid(DEMO_BOOKING.id) },
    {
      $set: {
        reference: DEMO_BOOKING.reference,
        customerId: oid(DEV_CUSTOMER.id),
        driverId: oid(DEV_DRIVER.id),
        /*
         * ASSIGNED, which is the first status a transfer is legal from. It is also the one an
         * admin cancellation is most worth testing at: a driver is committed, so both parties
         * have to be told, and neither is charged.
         */
        status: 'ASSIGNED',
        serviceType: 'INCITY',

        pickup: { lat: SEVOKE_ROAD.lat, lng: SEVOKE_ROAD.lng },
        pickupAddress: 'Sevoke Road, Siliguri',
        drop: { lat: MATIGARA.lat, lng: MATIGARA.lng },
        dropAddress: 'Matigara, Siliguri',
        direction: null,
        distanceKm: 6,

        carCategory: 'SEDAN',
        vehicleType: 'MANUAL',
        preferFavouriteDrivers: false,

        walletCreditPaise: 0,
        walletDebtPaise: 0,

        quoteId: oid(DEMO_BOOKING.quoteId),
        fareSnapshot: DEMO_FARE_SNAPSHOT,

        /*
         * CASH, so this booking holds no payment. An admin cancellation therefore refunds nothing
         * and cannot fail on a gateway call to a payment that was never taken — which keeps the
         * fixture usable without Razorpay credentials.
         */
        paymentMode: 'CASH',
        paymentId: null,

        isScheduled: false,
        scheduledAt,
        dispatchAt: scheduledAt,
        assignedAt: scheduledAt,

        enRouteAt: null,
        arrivedAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancellationReason: null,
        waitingMinutes: null,
        waitingChargePaise: null,
        driverLateMinutes: null,

        startOtp: DEMO_BOOKING.startOtp,
        otpAttempts: 0,
      },
    },
    { upsert: true, new: true },
  ).exec();
}

/**
 * The frozen fare on the demo booking. Hand-written, and the arithmetic still has to hold:
 * `subtotal = lines`, `driver + company = subtotal`, `subtotal + tax = total`.
 *
 * A snapshot that did not reconcile would be a fixture that no real fare could ever be, and the
 * first thing it would break is the completion path that splits it. `perDay: null` because this
 * is an incity trip — an hourly package has no day to sell, so the demo booking deliberately
 * cannot be extended.
 */
const DEMO_FARE_SNAPSHOT = {
  version: 1,
  serviceType: 'INCITY',
  computedAt: new Date('2026-09-10T00:00:00.000Z'),
  source: {
    packageId: '00000000000000000000000d',
    packageName: 'Siliguri Hourly',
    variantId: '00000000000000000000000e',
    variantLabel: '3 Hours',
    pickupZoneId: '00000000000000000000000f',
    pickupZoneName: 'Siliguri Central',
    cityZoneId: null,
    cityName: 'Siliguri',
    terrain: null,
  },
  included: { minutes: 180 },
  fare: {
    serviceType: 'INCITY',
    lines: [{ code: 'BASE', label: '3 Hours', amountPaise: 90_000 }],
    subtotalPaise: 90_000,
    taxBps: 500,
    taxPaise: 4_500,
    totalPaise: 94_500,
    split: {
      commissionablePaise: 90_000,
      driverAmountPaise: 67_500,
      driverPaise: 67_500,
      companyPaise: 22_500,
    },
    perDay: null,
  },
} as const;

async function seedZones(zones: ZonesPublicContract): Promise<Map<string, 'created' | 'present'>> {
  const actor = { adminId: DEV_ADMIN.id };

  // One query, not one per zone. Active-only is the right filter: a superseded version keeps its
  // code, and the partial unique index means only the active one can block a create.
  const existing = new Set((await zones.list({ isActive: true })).map((z) => z.code));

  const outcome = new Map<string, 'created' | 'present'>();

  for (const zone of DEV_ZONES) {
    if (existing.has(zone.code)) {
      outcome.set(zone.code, 'present');
      continue;
    }

    await zones.create(
      {
        type: zone.type,
        name: zone.name,
        code: zone.code,
        geometry: zone.geometry,
        pickupChargeType: zone.pickupChargeType,
        pickupChargePaise: zone.pickupChargePaise,
      },
      actor,
    );
    outcome.set(zone.code, 'created');
  }

  return outcome;
}

/**
 * `--reset` for zones — through the contract, not `ZoneModel.deleteMany`.
 *
 * `deactivate` then `delete` because `DeleteZoneUseCase` refuses an active zone: the two steps
 * are the app's own path, and taking it means the reset leaves the same audit trail an admin
 * clearing these by hand would. Superseded versions are already inactive and need only the
 * second step.
 *
 * Runs BEFORE `resetIdentityCollections()`, which is load-bearing twice over: zones point at the
 * admin through `createdBy`, and the audit rows these deletions write are then swept by the
 * `auditlogs` clear that follows rather than surviving as orphans.
 */
async function resetZones(zones: ZonesPublicContract): Promise<void> {
  const [active, inactive] = await Promise.all([
    zones.list({ isActive: true }),
    zones.list({ isActive: false }),
  ]);

  const actor = { adminId: DEV_ADMIN.id };

  for (const zone of active) {
    await zones.deactivate(zone.id, actor);
    await zones.delete(zone.id, actor);
  }
  for (const zone of inactive) {
    await zones.delete(zone.id, actor);
  }

  console.log(`  ${'zones'.padEnd(16)} ${active.length + inactive.length} removed`);
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
  zoneOutcome: Map<string, 'created' | 'present'>,
): void {
  const rows = [
    ['ADMIN', DEV_ADMIN.phone, '/admin/auth', 'active'],
    ['DRIVER', DEV_DRIVER.phone, '/driver/auth', 'verified, off duty — has the demo trip'],
    ['DRIVER', DEV_DRIVER_TWO.phone, '/driver/auth', 'verified, off duty — free'],
    ['CUSTOMER', DEV_CUSTOMER.phone, '/customer/auth', '2 addresses, 1 vehicle'],
    ['CUSTOMER', DEV_CUSTOMER_EMPTY.phone, '/customer/auth', 'empty profile'],
  ];

  console.log('\n  Seeded accounts\n');
  console.log('  ROLE      PHONE           AUTH PATH        STATE');
  for (const [role, phone, path, state] of rows) {
    console.log(`  ${role?.padEnd(9)} ${phone?.padEnd(15)} ${path?.padEnd(16)} ${state}`);
  }
  /*
   * Printed with the accounts rather than left in the log, because the whole reason this
   * booking exists is that somebody is about to go looking for it in the panel.
   */
  console.log('\n  Demo booking\n');
  console.log(`  ${DEMO_BOOKING.reference}  ASSIGNED to ${DEV_DRIVER.fullName} — cash, Siliguri`);
  console.log(`  Panel: /bookings/${DEMO_BOOKING.id}`);
  console.log('  Actions there: Transfer driver, Cancel booking.');
  console.log(`  Re-run the seed to put it back on ${DEV_DRIVER.fullName} and test again.`);

  /**
   * The zones, and — for the ones already there — the fact that this run left them alone.
   *
   * `already present` is not noise. It is the difference between "your edits survived" and "the
   * seed just reverted the polygon you spent ten minutes drawing", and without the word nobody
   * can tell which happened.
   */
  console.log('\n  Seeded zones\n');
  console.log('  TYPE      CODE            NAME                  PICKUP CHARGE');
  for (const zone of DEV_ZONES) {
    const charge =
      zone.pickupChargeType === undefined
        ? '—'
        : zone.pickupChargeType === 'FREE'
          ? 'FREE'
          : zone.pickupChargePaise === undefined
            ? 'PAID, global default'
            : `PAID, ₹${zone.pickupChargePaise / 100}`;

    const state = zoneOutcome.get(zone.code) === 'present' ? 'already present' : '';
    const cells = [
      zone.type.padEnd(9),
      zone.code.padEnd(15),
      zone.name.padEnd(21),
      charge.padEnd(21),
      state,
    ];
    console.log(`  ${cells.join(' ')}`.trimEnd());
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
   * file an administrator — which is precisely what `STAGING_UNSAFE` opts into, and why that flag
   * is documented as belonging on a throwaway host only (config/env.ts).
   */
  if (isProduction && !allowDevShortcuts) {
    console.error(
      'seed refuses to run with NODE_ENV=production — it creates known-credential accounts. ' +
        'Set STAGING_UNSAFE=true if this really is a throwaway staging host.',
    );
    process.exit(1);
  }

  /**
   * `--reset` is destructive, so it sits BEHIND the production guard above rather than beside it.
   * The dangerous path must not be the one with the shorter route past the check.
   */
  const reset = process.argv.includes('--reset');

  await connectMongo();

  // After the connection: `MongoZoneRepository` is constructed here and its first query runs
  // moments later. Nothing in this container touches Redis, so the seed still needs only Mongo.
  const zones = buildZonesContainer().contract;

  if (reset) {
    console.log('\n  Clearing seeded data (--reset)\n');
    await resetZones(zones);
    await resetIdentityCollections();
  }

  await seedAdmin();
  // The second one OFF DUTY on purpose — that is the state the manual-assignment picker has to
  // warn about rather than hide, so the default seed exercises the interesting case.
  await seedDriver(DEV_DRIVER, { isOnDuty: false });
  await seedDriver(DEV_DRIVER_TWO, { isOnDuty: false });
  await seedCustomers();
  await seedReviews();

  // After both drivers and the customer exist — it references all three.
  await seedDemoBooking();

  // After the admin exists — every zone is `createdBy` that account.
  const zoneOutcome = await seedZones(zones);

  const foreign = await countForeignAccounts();

  logger.info(
    { accounts: DEV_ACCOUNTS.length, zones: [...zoneOutcome.values()].filter((o) => o === 'created').length, reset },
    'seed complete',
  );
  printSummary(env.DEV_FIXED_OTP, foreign, zoneOutcome);

  await disconnectMongo();
}

main().catch((err: unknown) => {
  logger.fatal({ err: String(err) }, 'seed failed');
  process.exit(1);
});
