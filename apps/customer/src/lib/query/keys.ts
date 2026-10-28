import type { RideHistoryView } from '@/features/rides/historyQuery';

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
   * `direction` and `scheduledAt` are part of the key because both change the PRICE, not just the
   * presentation: one-way and round trip are two different products with separate fares, and the
   * pickup instant decides whether the trip falls inside an early-morning or late-night surcharge
   * window.
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
      /** In the key because it is in the PRICE — the band fare multiplies by the days it spans. */
      returnAt: string | null,
    ) => ['quotes', pickup, drop, direction, scheduledAt, returnAt] as const,
  },
  /**
   * The wallet balance, which the fare sheet and the wallet screen both read.
   *
   * ONE KEY FOR BOTH, so confirming a booking invalidates the figure the wallet screen shows just
   * as surely as the one the fare sheet quoted.
   */
  wallet: {
    me: () => ['wallet'] as const,
  },

  /**
   * The published FAQs. One key, no parameters — every customer gets the same list, and the
   * server decides what is in it.
   */
  faqs: {
    all: () => ['faqs'] as const,
  },

  /**
   * The customer's favourite drivers.
   *
   * ONE KEY, NO PARAMETERS, and every screen with a heart on it reads the same entry. That is the
   * whole point: the rate screen, the live trip card, a past ride and the manage page all decide
   * whether their heart is filled from this one list, so a tap on any of them fills the heart on
   * all four without a re-fetch per screen.
   */
  favourites: {
    all: () => ['favourites'] as const,
  },

  bookings: {
    all: () => ['bookings'] as const,
    /**
     * Ride history. A sibling of `all()` rather than a child, so invalidating one booking's detail
     * does not drop the whole list and make the history screen flash a spinner after a cancel.
     */
    list: () => ['bookings', 'list'] as const,
    /**
     * One filtered view of the history, paged. Under `list()`, so invalidating the list drops
     * every view of it at once.
     */
    history: (view: RideHistoryView) => ['bookings', 'list', view] as const,
    detail: (id: string) => ['bookings', id] as const,
    /** This trip's GST invoice request (and the form's pre-fill). Under the trip's own key. */
    gstInvoice: (id: string) => ['bookings', id, 'gst-invoice'] as const,
    /** "Am I in the middle of a booking?" — asked on launch, and on Home regaining focus. */
    current: () => ['bookings', 'current'] as const,
  },
} as const;
