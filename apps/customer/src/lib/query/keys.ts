/**
 * Query keys as a factory, never string literals at call sites. A mutation invalidates
 * `keys.profile.all()` and every dependent screen updates; with literals scattered around, one
 * is eventually spelled differently and a screen goes stale in a way nobody reproduces.
 */
export const keys = {
  profile: {
    all: () => ['profile'] as const,
    me: () => ['profile', 'me'] as const,
  },
  addresses: {
    all: () => ['addresses'] as const,
  },
  vehicles: {
    all: () => ['vehicles'] as const,
  },
  coverage: {
    check: (lat: number, lng: number) => ['coverage', 'check', lat, lng] as const,
  },
  /**
   * Keyed on the TRIP, not on a quote id — the id does not exist until the answer comes back.
   * Coordinates are rounded into the key for the same reason they are in `coverage.check`: a
   * float differing in its fifteenth decimal is the same street corner, and an unrounded key
   * would miss the cache and re-ask the server on every render that recreates the point.
   *
   * `direction`, `scheduledAt` and `insurance` are part of the key because all three change the
   * PRICE, not just the presentation: one-way and round trip are two different products with
   * separate fares, the pickup instant decides whether the trip falls inside an early-morning or
   * late-night surcharge window, and the insurance line is either on the fare card or it is not.
   * `direction`/`scheduledAt` are `null` for their default — "the server decides" — so a caller
   * that has not chosen shares a cache entry with one that explicitly chose the default.
   */
  quotes: {
    all: () => ['quotes'] as const,
    forTrip: (
      pickup: readonly [number, number],
      drop: readonly [number, number],
      direction: string | null,
      scheduledAt: string | null,
      insurance: boolean,
    ) => ['quotes', pickup, drop, direction, scheduledAt, insurance] as const,
  },
} as const;
