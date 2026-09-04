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
    current: () => ['offers', 'current'] as const,
  },
  documents: {
    all: () => ['documents'] as const,
    list: () => ['documents', 'list'] as const,
  },
  trip: {
    all: () => ['trip'] as const,
    detail: (bookingId: string) => ['trip', bookingId] as const,
    /** The recovery read — "am I in the middle of a trip?", asked on every launch. */
    current: () => ['trip', 'current'] as const,
  },
  earnings: {
    all: () => ['earnings'] as const,
    /**
     * The statement. ONE key for every page, not a key per page: `useInfiniteQuery` accumulates
     * the pages under this single entry, so "load more" extends the cached list instead of
     * replacing it, and a refetch re-reads every page already on screen rather than silently
     * leaving older ones stale against a balance that has since moved.
     */
    statement: () => ['earnings', 'statement'] as const,
  },
} as const;
