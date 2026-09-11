import type { Role } from '@driverzone/contracts';

/**
 * The accounts `pnpm seed` creates, and the only numbers the dev OTP bypass will ever accept.
 *
 * Everything here is FIXED — phone numbers, names, and the Mongo `_id`s. That determinism is the
 * point: "driver …0002 never gets the offer" has to mean the same thing in your terminal as in
 * mine, or a bug that depends on the shape of the data cannot be reproduced across machines
 * (docs/setup-development.md §Seed data).
 *
 * It lives in `config/` rather than inside the identity module for a concrete reason: the seed
 * script at `src/scripts/seed.ts` is not on `.eslintrc.cjs`'s import-exemption list, so it cannot
 * reach into `@/modules/identity/domain/*`. Both the seed and the container read this file, which
 * keeps "which numbers are dev accounts" in exactly one place.
 *
 * The `_id`s are hand-written 24-hex ObjectIds with a readable tail, so a document turning up in
 * a log or a Mongo shell is recognisable as seed data at a glance rather than looking like a real
 * account someone created.
 */

export interface DevAccount {
  id: string;
  role: Role;
  phone: string;
  fullName: string;
}

export const DEV_ADMIN: DevAccount = {
  id: '000000000000000000000001',
  role: 'ADMIN',
  phone: '+919000000001',
  fullName: 'Dev Admin',
};

/**
 * Seeded already APPROVED and verified, so a developer can go on duty immediately.
 *
 * The one the demo booking is assigned to — see `DEMO_BOOKING` below.
 */
export const DEV_DRIVER: DevAccount = {
  id: '000000000000000000000002',
  role: 'DRIVER',
  phone: '+919000000002',
  fullName: 'Dev Driver',
};

/**
 * A SECOND approved driver, holding no trip.
 *
 * It exists because half the things worth testing need somewhere for a booking to GO: a manual
 * transfer needs a driver to transfer to, a dispatch wave needs more than one candidate to rank,
 * and "driver …0002 never got the offer" is only a meaningful sentence when there is an …0005 who
 * did. One driver made every one of those untestable without hand-building a second account
 * differently on each machine — the exact drift `devAccounts.ts` exists to prevent.
 *
 * Seeded OFF DUTY, deliberately. That is the state the manual-assignment picker has to warn about
 * rather than hide, so the default seed exercises the interesting case.
 */
export const DEV_DRIVER_TWO: DevAccount = {
  id: '000000000000000000000005',
  role: 'DRIVER',
  phone: '+919000000005',
  fullName: 'Dev Driver Two',
};

/** Full profile, saved addresses, a vehicle — the populated case. */
export const DEV_CUSTOMER: DevAccount = {
  id: '000000000000000000000003',
  role: 'CUSTOMER',
  phone: '+919000000003',
  fullName: 'Dev Customer',
};

/**
 * Phone number and nothing else — the state `otp/verify` leaves a brand-new signup in.
 *
 * Worth seeding separately because progressive profile completion means every screen has to
 * render an account with no name, no addresses and no vehicles, and that empty state is where
 * those bugs actually live.
 */
export const DEV_CUSTOMER_EMPTY: DevAccount = {
  id: '000000000000000000000004',
  role: 'CUSTOMER',
  phone: '+919000000004',
  fullName: 'Dev Customer (empty)',
};

export const DEV_ACCOUNTS: DevAccount[] = [
  DEV_ADMIN,
  DEV_DRIVER,
  DEV_DRIVER_TWO,
  DEV_CUSTOMER,
  DEV_CUSTOMER_EMPTY,
];

/**
 * A booking sitting at `ASSIGNED` on `DEV_DRIVER`, so the admin panel's ops actions have
 * something to act on the moment the database is seeded.
 *
 * WHY A FIXED BOOKING AND NOT "JUST MAKE ONE IN THE APP". Reaching `ASSIGNED` by hand means a
 * quote, a payment, a driver on duty inside the pickup radius with a fresh GPS fix, and a
 * dispatch wave that actually rings — five moving parts, any of which can fail for reasons
 * unrelated to what is being tested. Transferring a booking to another driver, or cancelling one
 * as an admin, needs none of that; it needs a booking with a driver on it.
 *
 * The `_id`, the reference and the OTP are all fixed for the same reason every other id here is:
 * so a bug found on one machine can be described on another.
 */
export const DEMO_BOOKING = {
  id: '00000000000000000000000b',
  /** The `DZ-` alphabet excludes 0/O and 1/I — these are read down a phone line. */
  reference: 'DZ-DEMO01',
  /** No `quotes` row is seeded, so this points at nothing. Nothing reads it back. */
  quoteId: '00000000000000000000000c',
  startOtp: '4821',
} as const;

/**
 * The allowlist the OTP bypass is scoped to.
 *
 * Scoped rather than global so that signing up any other number in development still goes
 * through real code generation, hashing and attempt-burning — otherwise a bug in that path would
 * not surface until staging.
 */
export const DEV_ACCOUNT_PHONES: string[] = DEV_ACCOUNTS.map((a) => a.phone);
