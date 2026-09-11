import type { BookingDto } from '@driverzone/contracts';
import type { TripPoint } from './tripPoint';

/**
 * "Book again" — carrying one past trip's two ends back to the home map.
 *
 * ONE FILE FOR BOTH SIDES OF THE HANDOFF. The ride list and the ride detail write these params
 * and home reads them; spelling them at three call sites is how one of them eventually says
 * `dropLng` where the others say `drop_lng`, and the failure is a silent half-filled trip rather
 * than anything that errors.
 *
 * WHY PARAMS AND NOT A STORE. Home is a tab that may already be mounted, already have a pickup,
 * and already be mid-quote. A navigation carrying its intent with it is the thing expo-router
 * already models, and it survives the app being killed between the tap and the screen. A module
 * variable would not, and a context would put a booking-shaped value in a provider that nothing
 * else needs.
 *
 * WHAT IS DELIBERATELY NOT COPIED: the time, the direction, and the car. The pickup instant of a
 * trip taken last Tuesday is in the past, and silently reusing a stale one is how a customer
 * books a ride for a moment that has already gone. Everything else about the old trip is a
 * decision worth taking again — this carries the two answers that are genuinely tedious to
 * re-enter, which is exactly what the feature is for.
 */

/** The `?…` half of the route. Strings, because that is all a URL can hold. */
export interface RebookParams extends Record<string, string> {
  pickupLat: string;
  pickupLng: string;
  pickupAddress: string;
  dropLat: string;
  dropLng: string;
  dropAddress: string;
}

/** Every key above, so home can clear them in one place after applying them. */
export const REBOOK_PARAM_KEYS = [
  'pickupLat',
  'pickupLng',
  'pickupAddress',
  'dropLat',
  'dropLng',
  'dropAddress',
] as const;

export function rebookParamsFor(booking: BookingDto): RebookParams {
  return {
    pickupLat: String(booking.pickup.lat),
    pickupLng: String(booking.pickup.lng),
    pickupAddress: booking.pickup.address,
    dropLat: String(booking.drop.lat),
    dropLng: String(booking.drop.lng),
    dropAddress: booking.drop.address,
  };
}

/** The same, from a history row — which carries the coordinates for exactly this reason. */
export function rebookParamsForPoints(pickup: TripPoint, drop: TripPoint): RebookParams {
  return {
    pickupLat: String(pickup.lat),
    pickupLng: String(pickup.lng),
    pickupAddress: pickup.address,
    dropLat: String(drop.lat),
    dropLng: String(drop.lng),
    dropAddress: drop.address,
  };
}

export interface RebookRequest {
  pickup: TripPoint;
  drop: TripPoint;
  /**
   * Identifies THIS request, so home can tell a fresh tap from a re-render of one it has already
   * applied. Derived from the values rather than a counter: two taps on the same past trip are
   * the same request, and re-applying it would fight a customer who has since moved the pin.
   */
  token: string;
}

/**
 * Reads the params back, or `null` when this navigation is not a rebook.
 *
 * STRICT: a partial set is `null`, not a half-applied trip. `useLocalSearchParams` can also hand
 * back an array when a key appears twice in a URL, so every value is narrowed to a string first —
 * `Number(['1','2'])` is `NaN`, but `Number([''])` is `0`, which would silently place a trip in
 * the Gulf of Guinea rather than failing.
 */
export function parseRebookParams(raw: Record<string, string | string[] | undefined>): RebookRequest | null {
  const pickupLat = numberFrom(raw['pickupLat']);
  const pickupLng = numberFrom(raw['pickupLng']);
  const dropLat = numberFrom(raw['dropLat']);
  const dropLng = numberFrom(raw['dropLng']);

  if (pickupLat === null || pickupLng === null || dropLat === null || dropLng === null) return null;

  const pickupAddress = stringFrom(raw['pickupAddress']) ?? '';
  const dropAddress = stringFrom(raw['dropAddress']) ?? '';

  return {
    pickup: { lat: pickupLat, lng: pickupLng, address: pickupAddress },
    drop: { lat: dropLat, lng: dropLng, address: dropAddress },
    token: `${String(pickupLat)},${String(pickupLng)}>${String(dropLat)},${String(dropLng)}`,
  };
}

function stringFrom(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

function numberFrom(value: string | string[] | undefined): number | null {
  const raw = stringFrom(value);
  if (raw === null || raw.trim() === '') return null;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
