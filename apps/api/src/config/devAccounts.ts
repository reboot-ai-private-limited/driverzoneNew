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
 * Note this is one driver, where docs/setup-development.md asks for about three — varied duty
 * states and vehicle classes, one suspended — because dispatch waves need several candidates to
 * be worth testing. There is no dispatch module yet, so one is enough today; whoever builds
 * dispatch should extend this rather than rediscovering the need.
 */
export const DEV_DRIVER: DevAccount = {
  id: '000000000000000000000002',
  role: 'DRIVER',
  phone: '+919000000002',
  fullName: 'Dev Driver',
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
  DEV_CUSTOMER,
  DEV_CUSTOMER_EMPTY,
];

/**
 * The allowlist the OTP bypass is scoped to.
 *
 * Scoped rather than global so that signing up any other number in development still goes
 * through real code generation, hashing and attempt-burning — otherwise a bug in that path would
 * not surface until staging.
 */
export const DEV_ACCOUNT_PHONES: string[] = DEV_ACCOUNTS.map((a) => a.phone);
