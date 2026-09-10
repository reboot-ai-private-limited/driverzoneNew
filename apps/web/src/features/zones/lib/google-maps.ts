import { DEFAULT_CENTER, hasApiKey, loadMapLibraries as loadLibraries } from '@/lib/googleMaps';

/**
 * The zone editor's own map setup. The loader itself — `setOptions`, the API key, the singleton
 * `importLibrary` — moved to `@/lib/googleMaps` on 2026-09-05 when the booking details screen
 * became a second caller; what stays here is what is actually specific to this editor.
 *
 * Nothing here is imported by `ZonesScreen` directly. `ZoneMap` is behind
 * `dynamic(..., { ssr: false })`, which keeps the whole Google bundle out of the List view and
 * off the server — the API reaches for `window` immediately and there is no server-rendered map
 * worth having.
 */
/**
 * Re-exported, not redeclared — both now live in `@/lib/googleMaps` because the dashboard's live
 * map needs them too. Keeping them reachable from here means the editor's own imports read the
 * same as they always did.
 */
export { hasApiKey, DEFAULT_CENTER };

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
  const libs = await loadLibraries('maps', 'places');
  return { maps: libs.maps as google.maps.MapsLibrary, places: libs.places as google.maps.PlacesLibrary };
}

export const DEFAULT_ZOOM = 11;

export const MAP_TYPES = ['roadmap', 'hybrid', 'terrain'] as const;
export type MapTypeId = (typeof MAP_TYPES)[number];
