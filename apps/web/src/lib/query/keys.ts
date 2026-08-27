import type { ListIncityPackagesQuery, ListZonesQuery } from '@driverzone/contracts';

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
    all: () => ['packages'] as const,
    incityList: (query?: ListIncityPackagesQuery) =>
      ['packages', 'incity', 'list', query ?? {}] as const,
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
  /** The signed-in admin's own profile. Changes when they change it. */
  identity: 5 * 60_000,
  /** Bookings, dispatch, driver locations. No useful stale window at all. */
  live: 0,
} as const;
