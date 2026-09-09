import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * The dynamic half of the app config. `app.json` stays the readable, reviewable base — this file
 * only adds the parts that must NOT be committed: the Google Maps keys.
 *
 * Both keys ship inside the binary — `com.google.android.geo.API_KEY` in the generated
 * AndroidManifest, `GMSApiKey` in the iOS Info.plist — and can be extracted from it. That is
 * unavoidable (`docs/engineering/frontend-architecture.md` makes the same point about the panel's
 * web key); the protection is CONFIGURATION on the Google Cloud side:
 *
 *   - **Android key** — Application restriction: Android apps → package `in.driverzone.customer`
 *     + the signing SHA-1 fingerprint. API restriction: **Maps SDK for Android** only.
 *   - **iOS key** — Application restriction: iOS apps → bundle id `in.driverzone.customer`.
 *     API restriction: **Maps SDK for iOS** only.
 *
 * They must be SEPARATE keys — from each other and from `apps/web`'s
 * `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`. A Google key takes exactly one application-restriction type,
 * so an Android package restriction, an iOS bundle restriction and the panel's HTTP-referrer
 * restriction cannot share a key.
 *
 * Kept in `apps/customer/.env` (gitignored) rather than `app.json` (tracked) so a working key is
 * never committed on the first build. See `apps/customer/.env.example` for how to generate them.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const androidGoogleMapsApiKey = process.env['GOOGLE_MAPS_ANDROID_API_KEY'] ?? '';
  const iosGoogleMapsApiKey = process.env['GOOGLE_MAPS_IOS_API_KEY'] ?? '';

  /**
   * `aps-environment` — which APNs environment the iOS build talks to.
   *
   * A SILENT FOOTGUN if hardcoded. A build entitled `development` that is uploaded to TestFlight
   * or the App Store receives NO push at all: Apple routes those through the production APNs
   * gateway, and the token minted under the development entitlement is not valid there. Nothing
   * errors — notifications simply never arrive, which is indistinguishable from a server that
   * never sent them.
   *
   * So it comes from the environment, defaulting to `development` (what a local `expo run:ios`
   * wants). Set `IOS_APS_ENVIRONMENT=production` for any build that leaves your machine.
   */
  const apsEnvironment =
    process.env['IOS_APS_ENVIRONMENT'] === 'production' ? 'production' : 'development';

  // A warning rather than a thrown error: `expo start` for Expo Go, `typecheck` and every CI task
  // evaluate this file too, and none of them need a key. Only a native build does, and a build
  // that quietly produced a black map is exactly what these lines exist to prevent.
  if (androidGoogleMapsApiKey.length === 0) {
    console.warn(
      '[app.config] GOOGLE_MAPS_ANDROID_API_KEY is not set — a native Android build will render an empty map. See apps/customer/.env.example.',
    );
  }
  if (iosGoogleMapsApiKey.length === 0) {
    console.warn(
      '[app.config] GOOGLE_MAPS_IOS_API_KEY is not set — a native iOS build will render an empty map. See apps/customer/.env.example.',
    );
  }

  return {
    ...config,
    name: config.name ?? 'DriverZone',
    slug: config.slug ?? 'driverzone-customer',
    ios: {
      ...config.ios,
      config: {
        ...config.ios?.config,
        // Expo's iOS Maps config plugin reads exactly this path and writes `GMSApiKey` into the
        // Info.plist plus the `GMSServices.provideAPIKey` call in the generated AppDelegate.
        googleMapsApiKey: iosGoogleMapsApiKey,
      },
      entitlements: {
        ...config.ios?.entitlements,
        'aps-environment': apsEnvironment,
      },
    },
    plugins: [
      ...(config.plugins ?? []),
      // The react-native-maps config plugin only takes the Android key; iOS goes through
      // `ios.config.googleMapsApiKey` above.
      ['react-native-maps', { androidGoogleMapsApiKey }],
    ],
  };
};
