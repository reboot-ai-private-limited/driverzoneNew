/**
 * `EXPO_PUBLIC_*` is inlined into the bundle at build time, exactly like `NEXT_PUBLIC_*` in
 * apps/web — so nothing secret belongs here, and pointing a build at a different API is a
 * rebuild rather than a restart.
 */
export const API_BASE_URL = process.env['EXPO_PUBLIC_API_BASE_URL'] ?? 'http://localhost:4000/api';

/** Public legal pages on the website — opened from the sign-in screen. */
export const TERMS_URL = 'https://www.driverzoneonline.com/terms';
export const PRIVACY_URL = 'https://www.driverzoneonline.com/privacy';

/** Every customer route the app calls is namespaced under this (apps/api/src/routes.ts). */
export const ROLE_PREFIX = '/customer';

/**
 * Google Places (New) key for search type-ahead, read by `features/location/placeSearch.ts`.
 *
 * Empty is a SUPPORTED state, not a misconfiguration: search falls back to the device geocoder,
 * which is what shipped before. See the provider note in `placeSearch.ts`.
 *
 * Unlike the Maps SDK keys — which `app.config.ts` writes into the native manifest — this one is
 * called from JS at runtime, so it must be `EXPO_PUBLIC_*` and is therefore READABLE IN THE
 * BUNDLE. Restrict it in the Cloud console (Places API only) and treat it as public.
 */
export const GOOGLE_PLACES_API_KEY = process.env['EXPO_PUBLIC_GOOGLE_PLACES_API_KEY'] ?? '';
