'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdminLiveDriverDto } from '@driverzone/contracts';
import { DEFAULT_CENTER, hasApiKey, loadMapLibraries } from '@/lib/googleMaps';

export interface LiveDriverMapProps {
  drivers: readonly AdminLiveDriverDto[];
}

/**
 * Where the fleet is, right now.
 *
 * THE MARKERS MOVE, and that is the whole difference from `TripRouteMap`, which draws two fixed
 * pins once and never touches them again. Here the query re-polls every fifteen seconds and hands
 * back a different set of positions, so the map is built ONCE and its markers are reconciled
 * against each new response — moved, added, removed. Tearing down and rebuilding the map on every
 * poll would blank the tiles four times a minute and throw away the admin's pan and zoom with it.
 *
 * Legacy `google.maps.Marker`, not `AdvancedMarkerElement` — the advanced marker requires a Map ID
 * configured in the Google Cloud console, which nobody has set up for this key. Same reasoning as
 * `TripRouteMap`, and the same conclusion.
 */

/** A position older than this is not evidence of where a driver is now — `MongoDriverPool`'s rule. */
const STALE_AFTER_MS = 2 * 60_000;

/** Wide enough to see the city, close enough that markers do not pile up. */
const DEFAULT_ZOOM = 12;

/**
 * Brand yellow: reachable by dispatch right now. Grey: on duty, but the last fix has aged out.
 *
 * The caller asks for on-duty drivers only, so `is_on_duty` is not the axis here — freshness is.
 * A grey marker is a driver sitting on duty whom no wave can route to, which is precisely the
 * thing an ops screen exists to surface and which no other screen shows.
 *
 * YELLOW RATHER THAN THE GREEN THIS USED TO BE, so an available driver reads as DriverZone on a
 * screen full of Google's own map colours. `#F2F200` is the mobile apps' `colors.brand` — NOT
 * `--color-accent`, the panel's near-white lime, which disappears against pale map tiles. Copied
 * rather than imported because the two palettes deliberately live apart (see the customer theme's
 * own header), and this is the one place the panel borrows the product's brand hue.
 *
 * INK TRAVELS WITH THE FILL. Yellow is a SURFACE — roughly 1.1:1 against white — so the white car
 * glyph the green badge wore is invisible on it, and so is a white ring. Each state therefore
 * names its own ink, used for both the glyph and the outline.
 */
const AVAILABLE = { fill: '#F2F200', ink: '#1a1a1a' } as const;
const AGED_OUT = { fill: '#9ca3af', ink: '#ffffff' } as const;

function markerPalette(driver: AdminLiveDriverDto, now: number): { fill: string; ink: string } {
  const stale = now - new Date(driver.last_location_at).getTime() > STALE_AFTER_MS;
  return stale ? AGED_OUT : AVAILABLE;
}

/**
 * Diameter of the coloured badge each car glyph sits inside, in px.
 *
 * Bigger than the 30 it started at: at that size the car inside the badge was a smudge at city
 * zoom, and picking a driver out of a cluster meant zooming in to identify shapes that should be
 * readable at a glance.
 */
const MARKER_SIZE = 38;

/**
 * A car, not a dot — same glyph `CarFront` from `lucide-react` draws elsewhere on this screen, so
 * a driver reads as a driver here too rather than as an abstract ping. `AdminLiveDriverDto` carries
 * no heading, so the car faces forward/up rather than toward its direction of travel — there is
 * nothing to point it by.
 *
 * A DATA URI IMAGE, not a `SymbolPath`: Google's marker-symbol paths are drawn in the marker's own
 * coordinate space with no easy way to compose a multi-stroke glyph inside a filled badge, where an
 * inline SVG string is exactly the format `Marker.icon.url` already accepts.
 */
function driverMarkerIcon({ fill, ink }: { fill: string; ink: string }): google.maps.Icon {
  /*
   * The viewBox stays 30 wide while `MARKER_SIZE` grew, so the whole badge scales as one — the
   * glyph keeps its proportions instead of rattling around inside a bigger circle.
   *
   * TWO RINGS. The inner one in `ink` is what separates the badge from the tiles beneath it; the
   * outer white one is what separates it from a dark road or a satellite view. A single ring
   * worked while the fill was a mid-green, and does not on a colour this light.
   */
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${MARKER_SIZE}" height="${MARKER_SIZE}" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="13.5" fill="#ffffff" opacity="0.9" />
      <circle cx="15" cy="15" r="12.5" fill="${fill}" stroke="${ink}" stroke-width="1.5" />
      <g transform="translate(6.5 7.5) scale(0.7)" fill="none" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8" />
        <path d="M7 14h.01" />
        <path d="M17 14h.01" />
        <rect width="18" height="8" x="3" y="10" rx="2" />
        <path d="M5 18v2" />
        <path d="M19 18v2" />
      </g>
    </svg>
  `.trim();

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new google.maps.Size(MARKER_SIZE, MARKER_SIZE),
    anchor: new google.maps.Point(MARKER_SIZE / 2, MARKER_SIZE / 2),
  };
}

export function LiveDriverMap({ drivers }: LiveDriverMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  /** Live markers by driver id, so each poll can update in place instead of rebuilding. */
  const markers = useRef<Map<string, google.maps.Marker>>(new Map());
  /** Bounds are fitted ONCE. See the effect below. */
  const hasFitted = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Build the map. Empty deps: this runs once and the marker effect below does the rest.
  useEffect(() => {
    if (!hasApiKey) {
      setFailed(true);
      return;
    }
    if (container.current === null || map.current !== null) return;

    let cancelled = false;

    void loadMapLibraries('maps')
      .then((libs) => {
        // React 19 StrictMode mounts, unmounts and remounts. A load promise from the first mount
        // can settle after that teardown, and building a map into a detached node leaks one.
        if (cancelled || container.current === null) return;
        const maps = libs.maps as google.maps.MapsLibrary;

        map.current = new maps.Map(container.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        });
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Reconcile markers against the latest positions.
  useEffect(() => {
    const instance = map.current;
    if (instance === null) return;

    const now = Date.now();
    const seen = new Set<string>();

    for (const driver of drivers) {
      seen.add(driver.id);
      const position = { lat: driver.lat, lng: driver.lng };
      const existing = markers.current.get(driver.id);

      if (existing === undefined) {
        markers.current.set(
          driver.id,
          new google.maps.Marker({
            position,
            map: instance,
            title: `${driver.full_name ?? 'Driver'} · ${driver.mobile_number}`,
            icon: driverMarkerIcon(markerPalette(driver, now)),
          })
        );
        continue;
      }

      // Moved, not recreated — a new marker at a new position flickers, and drops any info window
      // the admin has open on it.
      existing.setPosition(position);
      existing.setIcon(driverMarkerIcon(markerPalette(driver, now)));
    }

    // Gone from the response — off duty, or aged out entirely.
    for (const [id, marker] of markers.current) {
      if (seen.has(id)) continue;
      marker.setMap(null);
      markers.current.delete(id);
    }

    /*
     * FIT ONCE, ON THE FIRST RESPONSE THAT HAS ANYONE IN IT.
     *
     * Re-fitting on every poll would yank the viewport back every fifteen seconds — an admin who
     * zoomed into one neighbourhood would be thrown out to the whole city mid-look, repeatedly,
     * with no way to stop it. After the first fit the view belongs to whoever is driving it.
     */
    if (!hasFitted.current && drivers.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      for (const driver of drivers) bounds.extend({ lat: driver.lat, lng: driver.lng });
      instance.fitBounds(bounds, 48);
      hasFitted.current = true;
    }
  }, [drivers, ready]);

  // Markers hold a reference to the map; dropping the component without clearing them leaks each
  // one. The map itself is garbage once its container node goes.
  useEffect(() => {
    const registry = markers.current;
    return () => {
      for (const marker of registry.values()) marker.setMap(null);
      registry.clear();
    };
  }, []);

  if (failed) {
    return (
      <div className="flex h-80 items-center justify-center rounded-md bg-surface-muted px-6 text-center text-sm text-text-subtle">
        {hasApiKey
          ? 'The map could not be loaded.'
          : 'Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY and rebuild to see driver positions. Everything else on this screen still works.'}
      </div>
    );
  }

  return <div ref={container} className="h-80 w-full rounded-md bg-surface-muted" />;
}
