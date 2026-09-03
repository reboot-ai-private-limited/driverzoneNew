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
} as const;
