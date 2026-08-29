import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The dynamic half of the app config. `app.json` stays the readable, reviewable base — this file
 * only adds the parts that must NOT be committed.
 *
 * Exactly one such part today: the Google Maps Android key. It ends up as
 * `com.google.android.geo.API_KEY` in the generated AndroidManifest, which means it ships inside
 * the APK and can be extracted from it. That is unavoidable and not, by itself, the problem —
 * `docs/engineering/frontend-architecture.md` makes the same point about the panel's web key. The
 * key is protected by CONFIGURATION, and for Android that means:
 *
 *   - an APPLICATION restriction to package `in.driverzone.customer` plus the signing SHA-1, and
 *   - an API restriction to **Maps SDK for Android** alone.
 *
 * It must be a DIFFERENT key from `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in `apps/web/.env`. A Google
 * key accepts only one application-restriction type, so the panel's HTTP-referrer restriction and
 * an Android restriction cannot coexist on one key — and the panel's key is scoped to the Maps
 * JavaScript API, which Android does not use.
 *
 * Keeping it in `apps/customer/.env` (gitignored) rather than in `app.json` (tracked) is what
 * stops a working key from being committed the first time someone runs a build.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const androidGoogleMapsApiKey = process.env['GOOGLE_MAPS_ANDROID_API_KEY'] ?? '';

  if (androidGoogleMapsApiKey.length === 0) {
    // A warning rather than a thrown error: `expo start` for Expo Go, `typecheck` and every CI
    // task evaluate this file too, and none of them need a key. Only a native build does, and a
    // build that quietly produced a black map is exactly what this line exists to prevent.
    console.warn(
      '[app.config] GOOGLE_MAPS_ANDROID_API_KEY is not set — a native build will render an empty map. See apps/customer/.env.example.',
    );
  }

  return {
    ...config,
    name: config.name ?? 'DriverZone',
    slug: config.slug ?? 'driverzone-customer',
    plugins: [
      ...(config.plugins ?? []),
      ['react-native-maps', { androidGoogleMapsApiKey }],
    ],
  };
};
