'use client';

import { useEffect, useRef, useState } from 'react';
import { hasApiKey, loadMapLibraries } from '@/lib/googleMaps';

export interface TripRouteMapProps {
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
}

/**
 * Pickup and drop as two pins and a straight line between them, fit to bounds.
 *
 * THE LINE IS STRAIGHT, NOT THE DRIVEN ROUTE. Drawing the actual road path means the Directions
 * API — a separate Google product from the Maps JavaScript API this key is scoped to, billed
 * separately, and not something this key has been confirmed to have enabled. A straight line
 * between two real coordinates is an honest picture of where the trip went; a road-shaped line
 * implying a specific route that was never verified against the actual API would not be.
 *
 * Legacy `google.maps.Marker`, not `AdvancedMarkerElement` — the advanced marker needs a Map ID
 * configured in the Google Cloud console, which is a step nobody has taken for this key. A plain
 * marker needs nothing extra and is not going away.
 */
export function TripRouteMap({ pickup, drop }: TripRouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const [failed, setFailed] = useState(false);

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

        const instance = new maps.Map(container.current, {
          center: pickup,
          zoom: 12,
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        });

        new google.maps.Marker({
          position: pickup,
          map: instance,
          title: 'Pickup',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#16a34a',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });

        new google.maps.Marker({
          position: drop,
          map: instance,
          title: 'Destination',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#dc2626',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
          },
        });

        new google.maps.Polyline({
          path: [pickup, drop],
          map: instance,
          strokeColor: '#2563eb',
          strokeWeight: 3,
          strokeOpacity: 0.8,
        });

        const bounds = new google.maps.LatLngBounds();
        bounds.extend(pickup);
        bounds.extend(drop);
        instance.fitBounds(bounds, 32);

        map.current = instance;
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // Pickup/drop are fixed for the life of this booking — the map is built once, not re-fit on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <div className="flex h-full min-h-48 items-center justify-center rounded-md bg-surface-muted text-sm text-text-subtle">
        Map unavailable
      </div>
    );
  }

  return <div ref={container} className="h-full min-h-48 w-full rounded-md bg-surface-muted" />;
}
