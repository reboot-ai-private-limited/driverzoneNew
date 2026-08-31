import type { LocationGeocodedAddress } from 'expo-location';
import type { SavedAddressDto } from '@driverzone/contracts';

/**
 * One end of a trip: a coordinate the API will resolve, plus the words the customer reads.
 *
 * The coordinate is the truth. `address` is a label — a reverse-geocoded line, a saved
 * address's own text, or a coordinate string when the geocoder has nothing — and no decision
 * anywhere is ever taken from it. That separation matters because `POST /quotes` resolves zones
 * from `lat`/`lng` (docs/LLD/api-contracts.md); the address rides along for the receipt.
 */
export interface TripPoint {
  lat: number;
  lng: number;
  address: string;
}

export function fromSavedAddress(saved: SavedAddressDto): TripPoint {
  return { lat: saved.lat, lng: saved.lng, address: saved.address };
}

/**
 * The last-resort label, when reverse geocoding fails or returns nothing usable.
 *
 * Five decimal places is about a metre — enough to identify the pin, short enough to read. It is
 * deliberately NOT the word "Unknown": the customer picked a real point on a map and telling
 * them we lost it would be untrue.
 */
export function describeCoordinate(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/**
 * A reverse-geocode result → one readable line.
 *
 * Every field of `LocationGeocodedAddress` is nullable and the OS fills a different subset per
 * device and per point — a rural pin often has `city` and nothing else. So this takes the first
 * few parts that exist rather than assuming any particular one does, and falls back to the
 * coordinate when the whole result is empty.
 */
export function describePlace(
  place: LocationGeocodedAddress | undefined,
  lat: number,
  lng: number,
): string {
  if (place === undefined) return describeCoordinate(lat, lng);

  const parts = [
    place.name,
    place.street,
    place.district,
    place.subregion ?? place.city,
    place.region,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0)
    .filter((part) => !isPlusCode(part));

  // `name` is often the street number and `street` the same street — dropping the repeat keeps
  // the line from reading "12, 12 Sevoke Road".
  const unique = parts.filter((part, index) => parts.indexOf(part) === index);

  const line = unique.slice(0, 3).join(', ');
  return line.length > 0 ? line : describeCoordinate(lat, lng);
}

/**
 * A Google Plus Code — `PC8G+2C9`, and on Android the geocoder hands one back as the place's
 * `name` whenever the point has no street address, which in Siliguri is most of the time.
 *
 * It is a real, precise identifier and completely useless to read: a customer checking their
 * pickup wants "Hakim Para", not a grid reference. Dropped rather than translated, because the
 * parts after it are the human ones.
 *
 * The alphabet is Open Location Code's own base-20 set — deliberately excluding vowels, so a
 * genuine place name cannot match by accident.
 */
const PLUS_CODE = /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}$/i;

function isPlusCode(part: string): boolean {
  return PLUS_CODE.test(part);
}

/** True when two points are the same place for our purposes — inside about a metre. */
export function samePoint(a: TripPoint | null, b: TripPoint | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.lat - b.lat) < 0.00001 && Math.abs(a.lng - b.lng) < 0.00001;
}
