import { enqueueDispatch, enqueueWaveTimeout } from '@/shared/queue/dispatchJobs.js';
import { buildAdminContainer } from '@/modules/admin/admin.container.js';
import { buildBookingsContainer } from '@/modules/bookings/bookings.container.js';
import { buildDispatchContainer } from '@/modules/dispatch/dispatch.container.js';
import { buildHealthContainer } from '@/modules/health/health.container.js';
import { buildIdentityContainer } from '@/modules/identity/identity.container.js';
import { buildLedgerContainer } from '@/modules/ledger/ledger.container.js';
import { buildNotificationsContainer } from '@/modules/notifications/notifications.container.js';
import { buildPackagesContainer } from '@/modules/packages/packages.container.js';
import { buildPaymentsContainer } from '@/modules/payments/payments.container.js';
import { buildQuotesContainer } from '@/modules/quotes/quotes.container.js';
import { buildReviewsContainer } from '@/modules/reviews/reviews.container.js';
import { buildSettingsContainer } from '@/modules/settings/settings.container.js';
import { buildWalletContainer } from '@/modules/wallet/wallet.container.js';
import { buildZonesContainer } from '@/modules/zones/zones.container.js';

/**
 * THE APPLICATION COMPOSITION ROOT.
 *
 * Every module container is built here, in dependency order, and the contracts they expose are
 * threaded into the modules that need them. As modules land this file grows into the readable
 * summary of the whole dependency graph — the tier list in `.dependency-cruiser.cjs` is the
 * machine-checked version of what this file does by hand.
 *
 * Build order must respect those tiers. A module cannot receive a contract that has not been
 * constructed yet, so if the wiring below ever needs to run backwards, the tiers are wrong.
 *
 * Separate from `routes.ts` on purpose. Both entrypoints need the modules; only one of them
 * serves HTTP. The worker imports this file and never touches Express.
 */
export interface AppContainers {
  health: ReturnType<typeof buildHealthContainer>;
  settings: ReturnType<typeof buildSettingsContainer>;
  identity: ReturnType<typeof buildIdentityContainer>;
  notifications: ReturnType<typeof buildNotificationsContainer>;
  ledger: ReturnType<typeof buildLedgerContainer>;
  payments: ReturnType<typeof buildPaymentsContainer>;
  wallet: ReturnType<typeof buildWalletContainer>;
  zones: ReturnType<typeof buildZonesContainer>;
  packages: ReturnType<typeof buildPackagesContainer>;
  quotes: ReturnType<typeof buildQuotesContainer>;
  bookings: ReturnType<typeof buildBookingsContainer>;
  dispatch: ReturnType<typeof buildDispatchContainer>;
  reviews: ReturnType<typeof buildReviewsContainer>;
  admin: ReturnType<typeof buildAdminContainer>;
}

export function buildContainers(): AppContainers {
  // tier 0 — depends on no other module
  const health = buildHealthContainer();
  /** Also tier 0. `quotes` is its first real consumer — the fare engine reads every surcharge,
   * insurance and tax figure out of the snapshot rather than out of a constant. */
  const settings = buildSettingsContainer();

  // tier 1 — customers, drivers, admins, auth
  const identity = buildIdentityContainer();

  /*
   * tier 2 — three modules that know nothing of each other and are consumed from above.
   * `notifications` reaches a person, `ledger` records what a driver is owed, `payments` collects
   * from a customer. Their adapters are mocks today; the ports are the real design.
   */
  /* Handed identity's device registries — tier 1, already built above. This module reaches a
   * person; identity knows which handsets are theirs. */
  const notifications = buildNotificationsContainer({
    driverDevices: identity.driverDevices,
    customerDevices: identity.customerDevices,
  });
  const ledger = buildLedgerContainer({ settings: settings.contract });
  const payments = buildPaymentsContainer();
  /* Also tier 2. A CUSTOMER ledger where `ledger` above is a driver one; the two never speak. */
  const wallet = buildWalletContainer();

  // tier 3 — polygons, resolution, the invariant write guard
  const zones = buildZonesContainer();

  // tier 4 — incity + outstation package definitions
  const packages = buildPackagesContainer();

  /*
   * tier 5 — the first module that composes several others. It is handed CONTRACTS, never
   * containers: it can resolve a zone and read a package, and is structurally unable to write
   * either.
   */
  const quotes = buildQuotesContainer({
    zones: zones.contract,
    packages: packages.contract,
    settings: settings.contract,
  });

  /*
   * tier 6 — the trip itself.
   *
   * `scheduleDispatch` ENQUEUES A JOB rather than calling dispatch, and that indirection is the
   * point: `dispatch` sits a tier ABOVE this one, so bookings must never learn how a driver is
   * found. That is what keeps "only dispatch writes driverId" structurally true rather than
   * merely observed — and it is why the queue, not an import, closes the loop.
   */
  const bookings = buildBookingsContainer({
    quotes: quotes.contract,
    payments: payments.contract,
    settings: settings.contract,
    ledger: ledger.contract,
    wallet: wallet.contract,
    notifications: notifications.contract,
    // Tier 1, built well above — the read side, so the driver's trip list can name its customers.
    identity: identity.contract,
    scheduleDispatch: (booking) => enqueueDispatch(booking.id, booking.dispatchAt),
  });

  // tier 7 — the only module permitted to set bookings.driverId
  const dispatch = buildDispatchContainer({
    bookings: bookings.contract,
    settings: settings.contract,
    notifications: notifications.contract,
    scheduleWaveTimeout: enqueueWaveTimeout,
  });

  /*
   * Also tier 7, beside `dispatch` rather than above it: the two never speak. A review is written
   * after the trip is over, so it needs to READ a finished booking and nothing more — which is
   * why it is handed `BookingReviewContract` and not the dispatch contract `bookings` exposes.
   */
  const reviews = buildReviewsContainer({
    bookings: bookings.contract,
    identity: identity.contract,
    settings: settings.contract,
  });

  /*
   * LAST, and at the top of the tier list. It is the first module here that reads across four
   * tiers at once — balances from `ledger` joined with names from `identity` — which is what a
   * tier-8 module is for. Nothing below it may ever depend on it, which is precisely what makes
   * it a safe place to put a screen that needs to see everything.
   */
  const admin = buildAdminContainer({
    ledger: ledger.financeContract,
    wallet: wallet.financeContract,
    identity: identity.contract,
  });

  return {
    health,
    settings,
    identity,
    notifications,
    ledger,
    payments,
    wallet,
    zones,
    packages,
    quotes,
    bookings,
    dispatch,
    reviews,
    admin,
  };
}
