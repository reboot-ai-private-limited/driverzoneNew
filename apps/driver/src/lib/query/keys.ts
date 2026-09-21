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
  offers: {
    all: () => ['offers'] as const,
    /**
     * Every live offer, not a single "current" one — a driver can legitimately hold more than
     * one at once (2026-09-04). `all()` still invalidates this along with it, since it is one
     * more entry under the same prefix.
     */
    list: () => ['offers', 'list'] as const,
  },
  /**
   * The scheduled board — parked trips a driver can browse and take.
   *
   * A SEPARATE PREFIX FROM `offers`, not a branch of it. Accepting from the board invalidates
   * this and the driver's own trip list; it must NOT invalidate live offers, which are a
   * different thing on a different clock.
   */
  scheduledBoard: {
    all: () => ['scheduled-board'] as const,
    list: () => ['scheduled-board', 'list'] as const,
  },
  documents: {
    all: () => ['documents'] as const,
    list: () => ['documents', 'list'] as const,
  },
  settings: {
    all: () => ['settings'] as const,
    /** `GET /driver/settings` — the driver-visible keys, cancellation penalties among them. */
    mine: () => ['settings', 'mine'] as const,
  },
  /**
   * The published FAQs. One key, no parameters — every driver gets the same list, and it is the
   * same list the customer app gets.
   */
  faqs: {
    all: () => ['faqs'] as const,
  },
  trip: {
    all: () => ['trip'] as const,
    detail: (bookingId: string) => ['trip', bookingId] as const,
    /** The recovery read — "am I in the middle of a trip?", asked on every launch. */
    current: () => ['trip', 'current'] as const,
    /**
     * The whole history. Under `trip` rather than beside it, so completing a trip can invalidate
     * `trip.all()` and refresh both the trip itself and the list it has just joined.
     */
    list: () => ['trip', 'list'] as const,
  },
  earnings: {
    all: () => ['earnings'] as const,
    /**
     * The statement. ONE key for every page, not a key per page: `useInfiniteQuery` accumulates
     * the pages under this single entry, so "load more" extends the cached list instead of
     * replacing it, and a refetch re-reads every page already on screen rather than silently
     * leaving older ones stale against a balance that has since moved.
     *
     * THE FILTER IS PART OF THE KEY, because it is part of the question. Filtering runs on the
     * server, so "payouts in March" and the whole statement are two different responses — sharing
     * one cache entry would show the previous filter's rows for a beat after every chip tap, on a
     * screen where a wrong row is a driver believing they were paid something they were not.
     */
    statement: (filter: Readonly<Record<string, unknown>> = {}) =>
      ['earnings', 'statement', filter] as const,
  },
} as const;
