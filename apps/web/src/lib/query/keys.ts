import type {
  AdminCustomerWalletsQuery,
  AdminDriverBalancesQuery,
  AdminFinanceTransactionsQuery,
  AdminListBookingsQuery,
  CustomerWalletQueryParams,
  LedgerQueryParams,
  ListIncityPackagesQuery,
  ListOutstationPackagesQuery,
  ListZonesQuery,
} from '@driverzone/contracts';
import type { ListCustomersQuery } from '../api/endpoints/customers';

/**
 * Query keys, as a factory. Never a string literal at a call site.
 *
 * A mutation invalidates `keys.zones.all()` and every dependent view updates. With literals
 * scattered across files one of them is eventually spelled differently, and the result is a
 * screen that goes stale in a way nobody can reproduce because the two keys look identical
 * in a diff.
 */
export const keys = {
  zones: {
    all: () => ['zones'] as const,
    list: (query?: ListZonesQuery) => ['zones', 'list', query ?? {}] as const,
    detail: (id: string) => ['zones', 'detail', id] as const,
    dependents: (id: string) => ['zones', 'dependents', id] as const,
    /**
     * The live geometry check. `fingerprint` is the SERIALISED polygon, not its id: this key
     * has to change on every vertex drag, and two shapes that hash the same would show the
     * verdict for the wrong one — which for a save-blocking check is the worst kind of wrong.
     */
    validate: (fingerprint: string) => ['zones', 'validate', fingerprint] as const,
  },
  packages: {
    /**
     * One root for both products, so a save on either invalidates the whole screen. They are
     * separate collections but one page, and the outstation coverage ladder is derived from the
     * list — a narrower key would leave a stale ladder next to a fresh row.
     */
    all: () => ['packages'] as const,
    incityList: (query?: ListIncityPackagesQuery) =>
      ['packages', 'incity', 'list', query ?? {}] as const,
    incityDetail: (id: string) => ['packages', 'incity', 'detail', id] as const,
    outstationList: (query?: ListOutstationPackagesQuery) =>
      ['packages', 'outstation', 'list', query ?? {}] as const,
    outstationDetail: (id: string) => ['packages', 'outstation', 'detail', id] as const,
  },
  settings: {
    /**
     * One key for the whole page. There is no per-key query and there should not be: the screen
     * reads every setting at once, and a save can change several of them, so a narrower key would
     * only create the chance of invalidating the wrong one.
     */
    all: () => ['settings'] as const,
  },
  faq: {
    /**
     * One key for the list, for the same reason as `settings.all()` and one more: the save
     * REPLACES the list, so there is no narrower thing to invalidate — every entry's `sort_order`
     * can change in a single write.
     */
    all: () => ['faq'] as const,
  },
  customers: {
    all: () => ['customers'] as const,
    // The query is PART of the key, because the list is paged and filtered server-side: page 2
    // of a search is a different resource from page 1, not the same one re-rendered.
    list: (query?: ListCustomersQuery) => ['customers', 'list', query ?? {}] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
    /**
     * One customer's wallet statement. The query is part of the key for the reason the driver
     * statement's is: a filtered page is a different resource, not the same one re-rendered.
     */
    wallet: (id: string, query?: CustomerWalletQueryParams) =>
      ['customers', 'wallet', id, query ?? {}] as const,
  },
  bookings: {
    all: () => ['bookings'] as const,
    // The query is PART of the key, for the reason customers' is: the list is paged and filtered
    // server-side, so page 2 of a date range is a different resource from page 1.
    list: (query?: AdminListBookingsQuery) => ['bookings', 'list', query ?? {}] as const,
    /** The details page — `GET /admin/bookings/:id`, not a row from the list. */
    detail: (id: string) => ['bookings', 'detail', id] as const,
    /** The timeline. Its own key because it is its own request, made only when the page loads. */
    events: (id: string) => ['bookings', 'events', id] as const,
  },
  /**
   * The driver directory and everything hanging off one driver.
   *
   * These were raw literals inside `features/drivers/hooks/useDriverDetails.ts` until the wallet
   * tab grew filters. A settlement has to invalidate a driver's wallet from a different feature
   * entirely, and "invalidate the key the other file spelled" is not something a call site can
   * do safely with a literal.
   *
   * THE PREFIX IS `drivers`, NOT `admin/drivers` — worth stating, because the literals that came
   * back were all `['admin', 'drivers', …]`. React Query matches by prefix, so the two families
   * never met: driver mutations invalidated `['admin','drivers']` and could not reach the wallet,
   * while `useSettleDriver` invalidated `['drivers']` and could not reach the list or the detail.
   * Both looked correct in isolation and in a diff. Everything under one driver hangs off
   * `all()`, and that is what makes a single invalidation enough.
   */
  drivers: {
    all: () => ['drivers'] as const,
    /**
     * The query is part of the key: the directory is filtered and paged server-side.
     *
     * `object` rather than `Record<string, unknown>` — the caller passes an interface, and a
     * TypeScript interface has no implicit index signature, so the stricter type rejects exactly
     * the shape this is for. React Query hashes the value structurally either way.
     */
    list: (query?: object) => ['drivers', 'list', query ?? {}] as const,
    detail: (id: string) => ['drivers', 'detail', id] as const,
    /** The query is part of the key: a filtered statement is a different resource. */
    wallet: (id: string, query?: LedgerQueryParams) =>
      ['drivers', 'wallet', id, query ?? {}] as const,
    /** Paged like the wallet, and for the same reason — a driver accumulates shifts for ever. */
    dutyHistory: (id: string, page = 1) => ['drivers', 'duty-history', id, page] as const,
  },
  finance: {
    all: () => ['finance'] as const,
    /** The query is part of the key: the list is filtered and paged server-side. */
    driverBalances: (query?: AdminDriverBalancesQuery) =>
      ['finance', 'driver-balances', query ?? {}] as const,
    transactions: (query?: AdminFinanceTransactionsQuery) =>
      ['finance', 'transactions', query ?? {}] as const,
    customerWallets: (query?: AdminCustomerWalletsQuery) =>
      ['finance', 'customer-wallets', query ?? {}] as const,
  },
  /**
   * The landing screen's tiles.
   *
   * Their own namespace rather than hanging off `bookings`/`drivers`/`finance`, even though they
   * read those same resources. A dashboard tile is a COUNT under a fixed filter, and the lists
   * are pages of rows — sharing a prefix would mean every booking mutation invalidated the tiles
   * and every tile refetch fought the list's own `keepPreviousData`. They are refreshed by their
   * own staleness instead, which is what a dashboard wants.
   */
  dashboard: {
    all: () => ['dashboard'] as const,
    bookingCounts: (day: string) => ['dashboard', 'booking-counts', day] as const,
    liveDrivers: () => ['dashboard', 'live-drivers'] as const,
    queues: () => ['dashboard', 'queues'] as const,
    debt: () => ['dashboard', 'debt'] as const,
    recentBookings: () => ['dashboard', 'recent-bookings'] as const,
  },
  admin: {
    profile: () => ['admin', 'profile'] as const,
  },
} as const;

/**
 * How long each kind of data stays fresh. See docs/engineering/frontend-architecture.md
 * §Staleness for why these numbers.
 */
export const staleTime = {
  /** Zones, packages, settings — edited by a few people who need to see each other's work. */
  configuration: 30_000,
  /**
   * Customer and driver records. Edited rarely and by one admin at a time, but a stale row is a
   * phone number somebody is about to dial, so this is far shorter than `identity`.
   */
  directory: 60_000,
  /** The signed-in admin's own profile. Changes when they change it. */
  identity: 5 * 60_000,
  /**
   * Finance aggregations. Between `directory` and `live` deliberately: these queries GROUP over
   * the whole ledger, so a zero stale window would re-scan the collection on every filter tweak
   * — but the numbers are money somebody is about to act on, so a minute is too long to trust.
   */
  finance: 15_000,
  /** Bookings, dispatch, driver locations. No useful stale window at all. */
  live: 0,
  /**
   * The dashboard's driver-debt tile, and ONLY that. Far longer than `finance` on purpose.
   *
   * `pageDriverBalances` groups the entire `driverEarnings` collection — `allowDiskUse: true`, and
   * its own comment says the real answer is a materialised balance. That is affordable on the
   * finance screen, which somebody opens deliberately. On the landing screen it would run on every
   * login and every navigation home, re-scanning all history to redraw one number.
   *
   * Five minutes means a working session pays for it once. Remove this the day the balance is
   * materialised, not before.
   */
  dashboardDebt: 5 * 60_000,
} as const;
