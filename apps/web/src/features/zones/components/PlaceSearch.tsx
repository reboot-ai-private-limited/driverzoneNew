'use client';

import { useEffect, useRef } from 'react';

/**
 * Type an address, the map goes there.
 *
 * THIS IS THE ANSWER TO THE POI GAP, and it is worth being precise about why. The problem was
 * never that a basemap fails to draw every shop — you do not trace a service boundary along a
 * shopfront, you trace it along a ring road, a river, or the edge of settlement. The problem was
 * ORIENTATION: standing on a map of Siliguri and not knowing which part of it you are looking at.
 *
 * A search box solves that directly and a denser label layer only solves it by accident.
 *
 * `PlaceAutocompleteElement`, not `places.Autocomplete` — the latter is legacy and Google has
 * stopped adding to it. It is a custom element rather than a React component, so it is mounted
 * imperatively into a host div and its listener is bound by hand.
 *
 * Search MOVES THE MAP AND NOTHING ELSE. It never touches the draft geometry: an admin
 * mid-boundary who looks up a landmark must not find their polygon changed when they get back.
 */
export function PlaceSearch({ map }: { map: google.maps.Map | null }) {
  const host = useRef<HTMLDivElement>(null);
  const element = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);

  useEffect(() => {
    if (map === null || host.current === null || element.current !== null) return;

    // Siliguri and its hinterland. Not a hard restriction — a hill zone reaches well past the
    // district — just a bias, so the first suggestion for "station" is the local one. Spread
    // conditionally: `exactOptionalPropertyTypes` is on repo-wide, under which passing an
    // explicit `undefined` is not the same as omitting the key.
    const bounds = map.getBounds();
    const autocomplete = new google.maps.places.PlaceAutocompleteElement({
      ...(bounds === undefined || bounds === null ? {} : { locationBias: bounds }),
      includedRegionCodes: ['in'],
    });

    // Without one the field is a magnifier over empty space, which reads as decoration rather
    // than a control. Set as an attribute because the element exposes no typed property for it.
    autocomplete.setAttribute('placeholder', 'Find a place');

    autocomplete.addEventListener('gmp-select', (event: Event) => {
      void (async () => {
        const { placePrediction } = event as unknown as {
          placePrediction: { toPlace: () => google.maps.places.Place };
        };
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ['location', 'viewport'] });

        // A viewport when the place has extent (a neighbourhood, a road), a point otherwise.
        // Zooming a whole suburb to street level would be worse than useless here.
        if (place.viewport) map.fitBounds(place.viewport);
        else if (place.location) {
          map.panTo(place.location);
          map.setZoom(15);
        }
      })();
    });

    host.current.appendChild(autocomplete);
    element.current = autocomplete;

    return () => {
      autocomplete.remove();
      element.current = null;
    };
  }, [map]);

  /**
   * The styling lives in `globals.css` under `.dz-place-search`, NOT in a Tailwind variant here.
   *
   * The previous `[&_input]:…` chain matched nothing: this custom element exposes no light-DOM
   * `input` to select, so every one of those utilities was dead and the element kept Google's
   * own dark-mode default — a black box on a light panel. It is themed through `color-scheme`
   * and its Material custom properties instead, which is the surface Google actually supports.
   */
  return <div ref={host} className="dz-place-search w-64" />;
}
