import * as Location from 'expo-location';
import { type TripPoint, describeCoordinate, describePlace } from '@/features/booking/tripPoint';

/**
 * Address ↔ coordinate, through the DEVICE's geocoder.
 *
 * Not Google Places. `docs/engineering/tech-choices.md` rejects a per-call place API for the
 * customer app — quote traffic runs ~3× bookings and this screen is the front door — and the
 * platform geocoder is free, keyless and offline-capable on Android. What it costs is
 * autocomplete and commercial POI depth, which is why the map pin, not the search box, is the
 * primary way a point gets set here.
 *
 * Both functions SWALLOW their failures by design. A geocoder that is rate-limited, offline or
 * simply has nothing for a rural pin is an ordinary Tuesday, not an error worth a red banner:
 * the coordinate is still valid and the trip can still be booked from it.
 */

/** Coordinate → a readable line. Never throws; falls back to the coordinate itself. */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    return describePlace(results[0], lat, lng);
  } catch {
    return describeCoordinate(lat, lng);
  }
}

/**
 * A typed query → the first match, or `null` when there is none.
 *
 * `null` is not an error state for the caller to report — it is "no result", and the screen says
 * so in one line rather than raising anything.
 */
export async function forwardGeocode(query: string): Promise<TripPoint | null> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return null;

  try {
    const results = await Location.geocodeAsync(trimmed);
    const first = results[0];
    if (first === undefined) return null;

    // The query is what the customer typed and recognises; a reverse lookup of the result would
    // usually return the same place in worse words.
    return { lat: first.latitude, lng: first.longitude, address: trimmed };
  } catch {
    return null;
  }
}
