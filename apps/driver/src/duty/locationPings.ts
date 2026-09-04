import type { LocationPingDto } from '@driverzone/contracts';
import * as Location from 'expo-location';
import { sendLocationPings } from '@/lib/api/endpoints/driver';

/**
 * The location loop that keeps a driver dispatchable.
 *
 * This is not telemetry. `MongoDriverPool` runs `$geoNear` against `lastLocation` and drops any
 * driver whose `lastLocationAt` is older than two minutes — so a driver who is on duty but not
 * pinging is invisible to every wave, and would never learn why. Duty and this loop start and
 * stop together for that reason.
 *
 * **Batched, never one request per fix.** A request per GPS fix drains the battery and, at
 * scale, costs a driver base (docs/LLD/api-contracts.md). Fixes accumulate in `buffer` and go up
 * every `FLUSH_INTERVAL_MS`.
 *
 * Foreground-only for now: `expo-location`'s background task needs the Android foreground
 * service from S-8, which is not built. So pings stop when the app is backgrounded, the driver
 * ages out of the pool within two minutes, and offers stop reaching them — which is honest,
 * because without the service the offer could not have rung anyway.
 */

/** How often the buffer is sent. Well inside the server's two-minute freshness window. */
const FLUSH_INTERVAL_MS = 15_000;

/** How often a fix is taken. ~5 fixes per flush, matching the 5–10 the contract asks for. */
const FIX_INTERVAL_MS = 3_000;

/**
 * Cap on the buffer.
 *
 * Only the newest fix is stored server-side, so an unbounded buffer during a long network outage
 * would send a large body to have all but one row discarded. Oldest are dropped first.
 */
const MAX_BUFFERED = 20;

/**
 * A fixed position to report instead of the real GPS, for development.
 *
 * The seeded zones are Siliguri; a phone anywhere else is outside every wave radius, so a real
 * booking finds no eligible driver and nothing rings — which looks exactly like a broken
 * dispatch. Setting `EXPO_PUBLIC_DEV_FIXED_LAT`/`_LNG` reports a coordinate near the seeded
 * pickup so the chain can be exercised from a desk.
 */
function devOverride(): { lat: number; lng: number } | null {
  const lat = Number(process.env['EXPO_PUBLIC_DEV_FIXED_LAT']);
  const lng = Number(process.env['EXPO_PUBLIC_DEV_FIXED_LNG']);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

let buffer: LocationPingDto[] = [];
let fixTimer: ReturnType<typeof setInterval> | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;

/** Called with the server's answer on every flush, so a duty change made elsewhere lands here. */
type DutyObserver = (isOnDuty: boolean) => void;
let observer: DutyObserver | null = null;

async function takeFix(): Promise<void> {
  const override = devOverride();

  let lat: number;
  let lng: number;
  let accuracy: number | undefined;

  if (override !== null) {
    lat = override.lat;
    lng = override.lng;
  } else {
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      lat = position.coords.latitude;
      lng = position.coords.longitude;
      accuracy = position.coords.accuracy ?? undefined;
    } catch {
      // A single failed fix is normal indoors. The next one is 3s away; dropping it silently is
      // correct, and the server's freshness window is the thing that notices a sustained outage.
      return;
    }
  }

  buffer.push({
    lat,
    lng,
    // CLIENT-supplied, and it must be: the app buffers offline and flushes on reconnect, so when
    // a fix was taken and when it arrives are different facts.
    recorded_at: new Date().toISOString(),
    ...(accuracy === undefined ? {} : { accuracy_m: accuracy }),
  });

  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
}

async function flush(): Promise<void> {
  if (buffer.length === 0) return;

  // Taken before the await so fixes arriving mid-request are not lost with the batch.
  const batch = buffer;
  buffer = [];

  try {
    const result = await sendLocationPings(batch);
    observer?.(result.is_on_duty);
  } catch {
    /*
     * Put them back, newest-capped. A driver in a lift should resume where they left off rather
     * than lose the gap — and the server only keeps the newest anyway, so a replayed stale batch
     * cannot move them backwards.
     */
    buffer = [...batch, ...buffer].slice(-MAX_BUFFERED);
  }
}

/**
 * Ask for location permission and start the loop.
 *
 * Returns whether it started: a driver who refuses permission cannot be dispatched, and the
 * caller needs to say so rather than leaving them on duty and never rung.
 */
export async function startLocationPings(onDutyChange?: DutyObserver): Promise<boolean> {
  if (fixTimer !== null) return true;

  if (devOverride() === null) {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return false;
  }

  observer = onDutyChange ?? null;

  // One immediately, so the driver is dispatchable within a second of going on duty rather than
  // after the first interval.
  void takeFix().then(() => flush());

  fixTimer = setInterval(() => void takeFix(), FIX_INTERVAL_MS);
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  return true;
}

export function stopLocationPings(): void {
  if (fixTimer !== null) clearInterval(fixTimer);
  if (flushTimer !== null) clearInterval(flushTimer);
  fixTimer = null;
  flushTimer = null;
  observer = null;
  // Dropped, not flushed: these describe where the driver was while working, and they have just
  // stopped working. Sending them would keep them in the dispatch pool for another two minutes.
  buffer = [];
}

export function isPinging(): boolean {
  return fixTimer !== null;
}

/**
 * ONE fix, for a request that has to prove where the driver is standing right now.
 *
 * The trip screen's `arrived` call needs this: the server refuses arrival beyond
 * `dispatch.arrival_radius_m` and rejects a stale fix outright, so it cannot reuse whatever the
 * ping buffer happens to hold — that could be minutes old, and the ping loop only runs while on
 * duty anyway.
 *
 * Shares `devOverride()` with the loop above on purpose. A developer whose
 * `EXPO_PUBLIC_DEV_FIXED_*` coordinates put them inside a seeded pickup zone would otherwise
 * report the override to dispatch and their real GPS to the arrival gate, and be refused arrival
 * on the one trip the override exists to let them run.
 *
 * `takenAt` is CLIENT time and the server compares it against its own to reject stale fixes —
 * which is exactly the check a phone with a badly wrong clock will fail. That is the intended
 * behaviour: a fix whose age cannot be trusted is not proof of anything.
 */
export async function currentFix(): Promise<{ lat: number; lng: number; takenAt: string } | null> {
  const takenAt = new Date().toISOString();

  const override = devOverride();
  if (override !== null) return { ...override, takenAt };

  try {
    const position = await Location.getCurrentPositionAsync({
      // Higher than the loop's `Balanced`: this one decides whether a driver can start earning.
      accuracy: Location.Accuracy.High,
    });
    return {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      takenAt: new Date().toISOString(),
    };
  } catch {
    // The caller turns this into "we could not confirm where you are", which is honest — unlike
    // sending a guessed coordinate to a gate that exists to stop exactly that.
    return null;
  }
}
