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
} as const;
