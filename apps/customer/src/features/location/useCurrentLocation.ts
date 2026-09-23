import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TripPoint } from '@/features/booking/tripPoint';
import { reverseGeocode } from './geocoding';
import { readLocationDecision, writeLocationDecision } from './locationConsent';

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

/**
 * `needs-consent` — the permission can be asked for, but the customer has not yet seen the
 * explanation that goes before it. The screen shows that explanation and answers with `allow` or
 * `decline`; nothing is prompted meanwhile, and the map stays on the fallback.
 */
export type LocationStatus = 'locating' | 'ready' | 'denied' | 'failed' | 'needs-consent';

/**
 * A ceiling on every native location call, because on this platform "never" is a real answer.
 *
 * Balanced accuracy indoors can legitimately take a while, so this is generous — but it is not
 * optional. Without it a single wedged native promise leaves the screen saying "Locating…" until
 * the app is killed, with no error, no timer and nothing the customer can press.
 */
const LOCATION_TIMEOUT_MS = 12_000;

/** Distinct from `null`, which is a real answer from `getLastKnownPositionAsync`. */
const TIMED_OUT = Symbol('location-timeout');

function withTimeout<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    work,
    new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), LOCATION_TIMEOUT_MS)),
  ]);
}

interface CurrentLocation {
  status: LocationStatus;
  /** Never null: the fallback stands in until (and if) a real fix arrives. */
  point: TripPoint;
  /** True once a real fix has been used, so the screen knows the pin is the customer's own. */
  isReal: boolean;
  locate: () => void;
  /** The explanation's "Allow": remembered, then Android's own prompt is shown. */
  allow: () => void;
  /** The explanation's "Not now": remembered, and nothing is asked until the customer asks. */
  decline: () => void;
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

      /**
       * CHECK FIRST, PROMPT ONLY IF THERE IS SOMETHING TO ASK.
       *
       * `requestForegroundPermissionsAsync` NEVER RESOLVES on ColorOS / realme UI when the
       * permission is ALREADY GRANTED — the same defect `startLocationPings` in the driver app
       * documents. It is silent and total: no throw, no rejection, just a promise that never
       * settles, so `status` stayed `'locating'` for the life of the process. On screen that was a
       * Pickup row reading "Locating…" forever, no blue dot, and a map parked on the Siliguri
       * fallback — for a customer whose permission was granted and whose GPS was on.
       *
       * It is invisible in testing on a fresh install, because the FIRST call genuinely shows a
       * dialog and resolves normally. Only later launches — every launch after the grant — hang.
       *
       * `getForegroundPermissionsAsync` always resolves, so it is the one on the hot path; the
       * prompting variant runs only when the grant is genuinely missing and askable.
       */
      let permission = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (permission !== null && !permission.granted && permission.canAskAgain) {
        /*
         * EXPLAIN BEFORE ASKING, but only on the automatic run at launch (`nonce === 0`). Any
         * later run is the customer asking — Allow on the explanation, or the locate button — and
         * that goes straight to Android's prompt. A customer who chose "Not now" is left alone on
         * every launch after, until they tap locate themselves.
         */
        if (nonce === 0) {
          const decision = await readLocationDecision();
          if (decision === null) {
            if (alive.current) setStatus('needs-consent');
            return;
          }
          if (decision === 'declined') {
            if (alive.current) setStatus('denied');
            return;
          }
        }
        permission = await Location.requestForegroundPermissionsAsync().catch(() => null);
      }

      if (permission === null) {
        if (alive.current) setStatus('failed');
        return;
      }
      if (!permission.granted) {
        if (alive.current) setStatus('denied');
        return;
      }

      // Local, not the `isReal` STATE: this closure captured that at effect-run time and would
      // read `false` no matter what the cached fix did.
      let adopted = false;

      try {
        const cached = await withTimeout(
          Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }),
        );
        if (cached !== null && cached !== TIMED_OUT && alive.current) {
          adopted = true;
          await adopt(cached.coords.latitude, cached.coords.longitude);
        }

        const fresh = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        );
        // A timeout is not a failure when the cache already answered: the map is on the customer's
        // own position, just not the refined fix. Only say `failed` when we have nothing at all.
        if (fresh === TIMED_OUT) {
          if (alive.current) setStatus(adopted ? 'ready' : 'failed');
          return;
        }

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

  const allow = useCallback(() => {
    void writeLocationDecision('accepted').then(() => setNonce((n) => n + 1));
  }, []);

  const decline = useCallback(() => {
    void writeLocationDecision('declined');
    // The same state a refused Android prompt leaves: fallback map, pin moved by hand.
    setStatus('denied');
  }, []);

  return { status, point, isReal, locate, allow, decline };
}
