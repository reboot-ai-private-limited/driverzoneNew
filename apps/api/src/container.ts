import { enqueueDispatch, enqueueWaveTimeout } from '@/shared/queue/dispatchJobs.js';
import { buildBookingsContainer } from '@/modules/bookings/bookings.container.js';
import { buildDispatchContainer } from '@/modules/dispatch/dispatch.container.js';
import { buildHealthContainer } from '@/modules/health/health.container.js';
import { buildIdentityContainer } from '@/modules/identity/identity.container.js';
import { buildLedgerContainer } from '@/modules/ledger/ledger.container.js';
import { buildNotificationsContainer } from '@/modules/notifications/notifications.container.js';
import { buildPackagesContainer } from '@/modules/packages/packages.container.js';
import { buildPaymentsContainer } from '@/modules/payments/payments.container.js';
import { buildQuotesContainer } from '@/modules/quotes/quotes.container.js';
import { buildSettingsContainer } from '@/modules/settings/settings.container.js';
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
  zones: ReturnType<typeof buildZonesContainer>;
  packages: ReturnType<typeof buildPackagesContainer>;
  quotes: ReturnType<typeof buildQuotesContainer>;
  bookings: ReturnType<typeof buildBookingsContainer>;
  dispatch: ReturnType<typeof buildDispatchContainer>;
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
  const notifications = buildNotificationsContainer();
  const ledger = buildLedgerContainer({ settings: settings.contract });
  const payments = buildPaymentsContainer();

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
    notifications: notifications.contract,
    scheduleDispatch: (booking) => enqueueDispatch(booking.id, booking.dispatchAt),
  });

  // tier 7 — the only module permitted to set bookings.driverId
  const dispatch = buildDispatchContainer({
    bookings: bookings.contract,
    settings: settings.contract,
    notifications: notifications.contract,
    scheduleWaveTimeout: enqueueWaveTimeout,
  });

  return {
    health,
    settings,
    identity,
    notifications,
    ledger,
    payments,
    zones,
    packages,
    quotes,
    bookings,
    dispatch,
  };
}
