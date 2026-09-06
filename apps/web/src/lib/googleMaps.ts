import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

/**
 * Loading the Maps JavaScript API, once, for the whole panel.
 *
 * MOVED HERE FROM `features/zones/lib/google-maps.ts` (2026-09-05), which used to be the only
 * feature with a map and said as much in its own comment — "this module is the only place that
 * calls it". The booking details screen is the second, and `setOptions` genuinely cannot run
 * twice: it configures the loader's singleton before any library import, so two call sites
 * racing to configure it with then-current-but-possibly-different options is exactly the bug
 * the original comment was written to rule out. Promoting it here, rather than copying it, is
 * what keeps that invariant true with a second caller instead of breaking it.
 *
 * The functional API (`setOptions` + `importLibrary`), not the `Loader` class — v2 of the loader
 * deprecates that class outright.
 */

/**
 * INLINED AT BUILD TIME, AND THEREFORE PUBLIC. Every `NEXT_PUBLIC_*` value ships to every
 * browser; for the Maps JS API that is unavoidable, because the key authenticates a script the
 * browser loads.
 *
 * The key is protected by CONFIGURATION, not by secrecy — an HTTP referrer restriction to the
 * panel's own domain, and an API restriction to the libraries the panel actually uses. See
 * docs/engineering/frontend-architecture.md §Environment.
 */
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export const hasApiKey = API_KEY !== '';

if (hasApiKey) {
  setOptions({
    key: API_KEY,
    // Pinned to the current stable channel rather than 'beta' — nothing here should follow a
    // channel Google reserves the right to change under it.
    v: 'weekly',
    region: 'IN',
    language: 'en',
  });
}

/**
 * Resolves one or more Maps JS libraries. `importLibrary` is idempotent per library — the first
 * call for a given name starts the script fetch, every later one (from any caller, any feature)
 * resolves from the same promise — so this can be called from as many places as need a map
 * without anyone having to coordinate who asks for what.
 */
export async function loadMapLibraries<K extends string>(
  ...names: K[]
): Promise<Record<K, google.maps.MapsLibrary | google.maps.PlacesLibrary | google.maps.RoutesLibrary>> {
  if (!hasApiKey) throw new Error('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set.');

  const loaded = await Promise.all(
    names.map((name) => importLibrary(name as Parameters<typeof importLibrary>[0])),
  );

  return Object.fromEntries(names.map((name, i) => [name, loaded[i]])) as Record<
    K,
    google.maps.MapsLibrary | google.maps.PlacesLibrary | google.maps.RoutesLibrary
  >;
}
