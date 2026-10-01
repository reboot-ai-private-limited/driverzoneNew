'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { DEFAULT_CENTER, hasApiKey, loadMapLibraries } from '@/lib/googleMaps';
import { placeLabel, pointLabelFromGeocode, type TripPoint } from '../lib/newBooking';

export type PointKind = 'pickup' | 'drop';

const COLORS: Record<PointKind, string> = { pickup: '#16a34a', drop: '#dc2626' };
const TITLES: Record<PointKind, string> = { pickup: 'Pickup', drop: 'Destination' };

/**
 * THE MAP ON THE NEW-BOOKING SCREEN — where the admin sets both ends of the trip.
 *
 * Three ways in, all writing the ACTIVE end (`active`, pickup or destination):
 *
 *   - SEARCH, in the box over the map — Google Places, the same element the zone editor uses. The
 *     label keeps the place's own name ("Hakimpara, Haren Mukherjee Road, …").
 *   - CLICK anywhere on the map.
 *   - DRAG either pin to fine-tune it — a searched place lands on a road centreline or a rooftop
 *     often enough that the gate the driver should stop at needs a nudge.
 *
 * A click or a drag has no place name, so it is labelled by REVERSE GEOCODING, falling back to the
 * nearest named place from Places when the key lacks the Geocoding API (see `labelFor`). Only if
 * both fail does the label stay the coordinate — which is what the trip is priced and dispatched
 * on, so the booking is still correct.
 *
 * Legacy `google.maps.Marker`, for the reason `TripRouteMap` gives: the advanced marker needs a
 * Map ID nobody has configured for this key.
 */
export function BookingPickerMap({
  pickup,
  drop,
  active,
  onChange,
}: {
  pickup: TripPoint | null;
  drop: TripPoint | null;
  active: PointKind;
  onChange: (kind: PointKind, point: TripPoint) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const searchHost = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const geocoder = useRef<google.maps.Geocoder | null>(null);
  const markers = useRef<Partial<Record<PointKind, google.maps.Marker>>>({});
  const line = useRef<google.maps.Polyline | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(!hasApiKey);

  // Listeners are bound once; they read the latest props through these.
  const activeRef = useRef(active);
  activeRef.current = active;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /*
   * One counter per end. A reverse geocode answers some hundreds of milliseconds later; if the pin
   * has moved again since, the late answer must not relabel the new spot with the old street.
   */
  const seq = useRef<Record<PointKind, number>>({ pickup: 0, drop: 0 });

  /** A coordinate with no name: set it now, label it when a lookup answers. */
  const setFromCoordinate = (kind: PointKind, lat: number, lng: number) => {
    const ticket = ++seq.current[kind];
    onChangeRef.current(kind, { lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });

    void labelFor(lat, lng).then((address) => {
      if (address === null || ticket !== seq.current[kind]) return;
      onChangeRef.current(kind, { lat, lng, address });
    });
  };

  /**
   * A readable name for a bare coordinate — TWO SOURCES, because the key may only have one.
   *
   * 1. The Geocoding API: a street address. Needs that API enabled on the key, separately from
   *    Places — and when it is not, every clicked pin used to stay a raw "26.71422, 88.42624".
   * 2. Places (New) `searchNearby`: the nearest named place within a short radius. The same API
   *    the search box already depends on, so it works on any key the search works on.
   *
   * Null when both come back empty; the coordinate label then stays, and it is still correct.
   */
  const labelFor = async (lat: number, lng: number): Promise<string | null> => {
    if (geocoder.current !== null) {
      try {
        const { results } = await geocoder.current.geocode({ location: { lat, lng } });
        const address = pointLabelFromGeocode(results);
        if (address !== null) return address;
      } catch (error) {
        // Logged, not shown: the usual cause is the Geocoding API not being enabled on the key,
        // which is a console fix, and the fallback below covers the admin in the meantime.
        console.warn('[booking map] reverse geocode failed — falling back to Places', error);
      }
    }

    try {
      const { places } = await google.maps.places.Place.searchNearby({
        fields: ['displayName', 'formattedAddress'],
        locationRestriction: { center: { lat, lng }, radius: 150 },
        maxResultCount: 1,
        rankPreference: google.maps.places.SearchNearbyRankPreference.DISTANCE,
      });
      const nearest = places[0];
      if (nearest === undefined) return null;
      const label = placeLabel(nearest.displayName, nearest.formattedAddress);
      return label === '' ? null : label;
    } catch (error) {
      console.warn('[booking map] nearby place lookup failed', error);
      return null;
    }
  };

  // ── Build the map, the search box and the click handler, once ──────────────────────────────
  useEffect(() => {
    if (!hasApiKey || container.current === null || map.current !== null) return;
    let cancelled = false;
    let search: google.maps.places.PlaceAutocompleteElement | null = null;

    void loadMapLibraries('maps', 'places')
      .then(async (libs) => {
        if (cancelled || container.current === null) return;
        const maps = libs.maps as google.maps.MapsLibrary;

        const instance = new maps.Map(container.current, {
          center: DEFAULT_CENTER,
          zoom: 13,
          disableDefaultUI: true,
          zoomControl: true,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        map.current = instance;

        instance.addListener('click', (event: google.maps.MapMouseEvent) => {
          if (event.latLng === null) return;
          setFromCoordinate(activeRef.current, event.latLng.lat(), event.latLng.lng());
        });

        // Geocoding is its own library; loaded separately so a key without it still gets a map.
        try {
          await loadMapLibraries('geocoding');
          if (!cancelled) geocoder.current = new google.maps.Geocoder();
        } catch {
          geocoder.current = null;
        }

        if (cancelled || searchHost.current === null) return;
        search = new google.maps.places.PlaceAutocompleteElement({
          includedRegionCodes: ['in'],
          locationBias: { center: DEFAULT_CENTER, radius: 30_000 },
        });
        search.setAttribute('placeholder', 'Search a place');
        search.addEventListener('gmp-select', (event: Event) => {
          void (async () => {
            const { placePrediction } = event as unknown as {
              placePrediction: { toPlace: () => google.maps.places.Place };
            };
            const place = placePrediction.toPlace();
            await place.fetchFields({ fields: ['location', 'displayName', 'formattedAddress'] });
            if (place.location === null || place.location === undefined) return;

            const kind = activeRef.current;
            seq.current[kind] += 1; // a geocode still in flight for this end is now stale
            onChangeRef.current(kind, {
              lat: place.location.lat(),
              lng: place.location.lng(),
              address: placeLabel(place.displayName, place.formattedAddress),
            });
            instance.panTo(place.location);
            if ((instance.getZoom() ?? 0) < 15) instance.setZoom(16);
          })();
        });
        searchHost.current.appendChild(search);

        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      search?.remove();
    };
    // Built once — the listeners read the latest props through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Keep the two pins and the line in step with the props ──────────────────────────────────
  useEffect(() => {
    const instance = map.current;
    if (!ready || instance === null) return;

    const sync = (kind: PointKind, point: TripPoint | null) => {
      const existing = markers.current[kind];
      if (point === null) {
        existing?.setMap(null);
        delete markers.current[kind];
        return;
      }
      if (existing !== undefined) {
        existing.setPosition(point);
        existing.setTitle(`${TITLES[kind]}: ${point.address}`);
        return;
      }
      const marker = new google.maps.Marker({
        position: point,
        map: instance,
        draggable: true,
        title: `${TITLES[kind]}: ${point.address}`,
        label: { text: kind === 'pickup' ? 'P' : 'D', color: '#ffffff', fontWeight: '700' },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: COLORS[kind],
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
        },
      });
      marker.addListener('dragend', (event: google.maps.MapMouseEvent) => {
        if (event.latLng === null) return;
        setFromCoordinate(kind, event.latLng.lat(), event.latLng.lng());
      });
      markers.current[kind] = marker;
    };

    sync('pickup', pickup);
    sync('drop', drop);

    if (pickup !== null && drop !== null) {
      if (line.current === null) {
        line.current = new google.maps.Polyline({
          map: instance,
          strokeColor: '#2563eb',
          strokeWeight: 3,
          strokeOpacity: 0.7,
        });
      }
      line.current.setPath([pickup, drop]);
    } else {
      line.current?.setMap(null);
      line.current = null;
    }
    // Only the coordinates matter here; a label change alone re-titles nothing worth a re-sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pickup?.lat, pickup?.lng, drop?.lat, drop?.lng, pickup?.address, drop?.address]);

  /*
   * FIT BOTH ENDS when the second one first appears, so the admin sees the whole trip. Not on
   * every change — re-fitting while someone is dragging a pin a few metres would yank the view
   * out from under them.
   */
  const bothSet = pickup !== null && drop !== null;
  useEffect(() => {
    if (!ready || !bothSet || map.current === null || pickup === null || drop === null) return;
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(pickup);
    bounds.extend(drop);
    map.current.fitBounds(bounds, 64);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, bothSet]);

  if (failed) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center gap-2 rounded-md bg-surface-muted p-6 text-center text-sm text-text-subtle">
        <MapPin aria-hidden className="size-5" />
        The map needs NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Enter the pickup and destination by hand in
        the form instead.
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-96 w-full overflow-hidden rounded-md bg-surface-muted">
      <div ref={container} className="absolute inset-0" />

      {/* Search, over the map. Writes whichever end is active. */}
      <div className="absolute inset-x-3 top-3 z-10 flex flex-col gap-2">
        <div ref={searchHost} className="dz-place-search w-full max-w-md rounded-md bg-surface shadow-md" />
        <span
          className="w-fit rounded-md px-2 py-1 text-xs font-medium text-white shadow"
          style={{ backgroundColor: COLORS[active] }}
        >
          Setting {TITLES[active].toLowerCase()} — search, click the map, or drag a pin
        </span>
      </div>
    </div>
  );
}
