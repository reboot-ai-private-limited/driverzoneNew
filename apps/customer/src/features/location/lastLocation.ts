import * as SecureStore from 'expo-secure-store';
import type { TripPoint } from '@/features/booking/tripPoint';

/**
 * The customer's last real position, kept across launches — so the map OPENS where they are.
 *
 * Without it every cold start opened on the pilot-city fallback and then had to fly to the
 * customer once GPS answered, which on a cold fix is seconds later and sometimes not at all. The
 * customer saw the wrong city, then a long flight (or a map that never left). Starting from the
 * last known spot makes the first real fix a small refinement — usually no visible move at all.
 *
 * It is ONLY a starting point for the camera. It never becomes the pickup: a person can be
 * kilometres from where they last opened the app, so the pickup still waits for a live fix.
 *
 * SecureStore, for the same reason `locationConsent` gives — one small value is not worth a
 * storage dependency. Read SYNCHRONOUSLY, because the map's initial region is fixed at mount and an
 * async read would land after it.
 */
const LAST_LOCATION_KEY = 'dz.customer.last_location';

/** Older than this, the remembered spot is more likely to mislead than help. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface Stored {
  lat: number;
  lng: number;
  address: string;
  at: number;
}

export function readLastLocation(): TripPoint | null {
  try {
    const raw = SecureStore.getItem(LAST_LOCATION_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof parsed.lat !== 'number' ||
      typeof parsed.lng !== 'number' ||
      typeof parsed.at !== 'number' ||
      Date.now() - parsed.at > MAX_AGE_MS
    ) {
      return null;
    }
    return { lat: parsed.lat, lng: parsed.lng, address: parsed.address ?? '' };
  } catch {
    return null;
  }
}

export function writeLastLocation(point: TripPoint): void {
  const value: Stored = { lat: point.lat, lng: point.lng, address: point.address, at: Date.now() };
  // Fire and forget: losing it only means the next launch opens on the fallback, as before.
  void SecureStore.setItemAsync(LAST_LOCATION_KEY, JSON.stringify(value)).catch(() => undefined);
}
