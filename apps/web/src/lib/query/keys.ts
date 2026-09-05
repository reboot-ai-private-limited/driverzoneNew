import type {
  AdminListBookingsQuery,
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
  customers: {
    all: () => ['customers'] as const,
    // The query is PART of the key, because the list is paged and filtered server-side: page 2
    // of a search is a different resource from page 1, not the same one re-rendered.
    list: (query?: ListCustomersQuery) => ['customers', 'list', query ?? {}] as const,
    detail: (id: string) => ['customers', 'detail', id] as const,
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
  /** Bookings, dispatch, driver locations. No useful stale window at all. */
  live: 0,
} as const;
