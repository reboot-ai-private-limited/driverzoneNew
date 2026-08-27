import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

/**
 * Loading the Maps JavaScript API, once.
 *
 * The functional API (`setOptions` + `importLibrary`), not the `Loader` class — v2 of the loader
 * deprecates that class outright.
 *
 * `setOptions` must run before ANY library is imported, so it runs at module scope here and this
 * module is the only place that calls it. `importLibrary` is idempotent: the first call starts
 * the script fetch, every later one resolves from the same promise, so callers can ask for what
 * they need without coordinating.
 *
 * Nothing here is imported by `ZonesScreen` directly. `ZoneMap` is behind
 * `dynamic(..., { ssr: false })`, which keeps the whole Google bundle out of the List view and
 * off the server — the API reaches for `window` immediately and there is no server-rendered map
 * worth having.
 */

/**
 * INLINED AT BUILD TIME, AND THEREFORE PUBLIC. Every `NEXT_PUBLIC_*` value ships to every
 * browser; for the Maps JS API that is unavoidable, because the key authenticates a script the
 * browser loads.
 *
 * The key is protected by CONFIGURATION, not by secrecy:
 *   • an HTTP referrer restriction limiting it to the panel's own domain, and
 *   • an API restriction to Maps JavaScript API + Places API only.
 *
 * Without both, this key is a billable liability the moment the bundle is served.
 * See docs/engineering/frontend-architecture.md §Environment.
 */
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export const hasApiKey = API_KEY !== '';

if (hasApiKey) {
  setOptions({
    key: API_KEY,
    // Pinned to the current stable channel rather than 'beta'. The zone editor is where every
    // service boundary in the product is drawn; it is the last screen that should follow a
    // channel Google reserves the right to change under it.
    v: 'weekly',
    region: 'IN',
    language: 'en',
  });
}

/**
 * The two libraries the editor uses.
 *
 * NOT `drawing`. `DrawingManager` was REMOVED from the Maps JavaScript API in v3.65 — it now
 * throws from its constructor, and `@types/google.maps` reflects that by declaring the class
 * with an empty body. Polygon drawing is therefore hand-rolled from map clicks in `ZoneMap`,
 * which is a dozen lines and leaves us owning the interaction anyway.
 *
 * Resolved together rather than staggered: the editor needs both within a second of mounting,
 * so one round trip beats two.
 */
export async function loadMapLibraries(): Promise<{
  maps: google.maps.MapsLibrary;
  places: google.maps.PlacesLibrary;
}> {
  if (!hasApiKey) throw new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set.');

  const [maps, places] = await Promise.all([importLibrary('maps'), importLibrary('places')]);

  return { maps, places };
}

/** Siliguri. The only city there is, so the editor opens on it rather than on the null island. */
export const DEFAULT_CENTER = { lat: 26.7271, lng: 88.4276 };
export const DEFAULT_ZOOM = 11;

export const MAP_TYPES = ['roadmap', 'hybrid', 'terrain'] as const;
export type MapTypeId = (typeof MAP_TYPES)[number];
