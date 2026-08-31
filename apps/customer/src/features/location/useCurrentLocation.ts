import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TripPoint } from '@/features/booking/tripPoint';
import { reverseGeocode } from './geocoding';

/**
 * Where the map opens: the customer's own position when they allow it, Siliguri when they do
 * not.
 *
 * Siliguri is not a placeholder — it is the pilot city (docs/LLD/roadmap.md phase 9) and the one
 * the dev seed draws zones for (`apps/api/src/config/devZones.ts`), so a denied permission still
 * lands on a map where coverage means something.
 */
export const FALLBACK_CENTRE: TripPoint = {
  lat: 26.7271,
  lng: 88.3953,
  address: 'Siliguri',
};

export type LocationStatus = 'locating' | 'ready' | 'denied' | 'failed';

interface CurrentLocation {
  status: LocationStatus;
  /** Never null: the fallback stands in until (and if) a real fix arrives. */
  point: TripPoint;
  /** True once a real fix has been used, so the screen knows the pin is the customer's own. */
  isReal: boolean;
  locate: () => void;
}

/**
 * A DENIED PERMISSION IS A NORMAL OUTCOME, NOT AN ERROR.
 *
 * A customer who declines location still has a working screen: the map opens on the pilot city
 * and they move the pin. Nothing here retries, escalates, or blocks — a permission prompt loop
 * on the first screen after sign-in is how an app gets uninstalled.
 *
 * The fix is fetched twice on purpose. `getLastKnownPositionAsync` usually answers immediately
 * from the OS cache, so the map settles somewhere plausible right away; `getCurrentPositionAsync`
 * then refines it. Waiting only for the accurate one leaves the map sitting on the wrong city
 * for several seconds on a cold GPS.
 */
export function useCurrentLocation(): CurrentLocation {
  const [status, setStatus] = useState<LocationStatus>('locating');
  const [point, setPoint] = useState<TripPoint>(FALLBACK_CENTRE);
  const [isReal, setIsReal] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Guards every `set*` after an await: this hook outlives none of its awaits on a fast
  // unmount, and a state write into an unmounted screen is a warning nobody can action.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    async function locate(): Promise<void> {
      setStatus('locating');

      let permission: Location.LocationPermissionResponse;
      try {
        permission = await Location.requestForegroundPermissionsAsync();
      } catch {
        if (alive.current) setStatus('failed');
        return;
      }

      if (!permission.granted) {
        if (alive.current) setStatus('denied');
        return;
      }

      try {
        const cached = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 });
        if (cached !== null && alive.current) {
          await adopt(cached.coords.latitude, cached.coords.longitude);
        }

        const fresh = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (alive.current) await adopt(fresh.coords.latitude, fresh.coords.longitude);
        if (alive.current) setStatus('ready');
      } catch {
        // Granted but unobtainable — location services off, no fix indoors. The fallback stands.
        if (alive.current) setStatus('failed');
      }
    }

    async function adopt(lat: number, lng: number): Promise<void> {
      // The coordinate lands first and the words follow: the map should move the moment we know
      // where we are, not once a geocoder has agreed on what to call it.
      setPoint({ lat, lng, address: '' });
      setIsReal(true);
      const address = await reverseGeocode(lat, lng);
      if (alive.current) setPoint({ lat, lng, address });
    }

    void locate();
  }, [nonce]);

  const locate = useCallback(() => setNonce((n) => n + 1), []);

  return { status, point, isReal, locate };
}
