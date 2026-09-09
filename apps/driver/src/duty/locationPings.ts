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
 * **These are JS timers, and they only survive a locked screen because the S-8 foreground service
 * holds the process open.** `dutyForegroundService.ts` is started before this loop and stopped
 * after it, deliberately: without it Android freezes the process seconds after the screen goes
 * off, the intervals stop firing, and the driver ages out of the pool's two-minute window while
 * their app still says "online". The service is what makes this loop a shift-long loop rather
 * than a foreground-only one.
 */

/** How often the buffer is sent. Well inside the server's two-minute freshness window. */
const FLUSH_INTERVAL_MS = 15_000;

/**
 * How often a fix is taken — ONE PER FLUSH, deliberately.
 *
 * This used to be 3s, giving ~5 fixes per request. Every one of those but the last was wasted: the
 * server stores only the newest fix and chooses it by `recorded_at`, never by quality, so the other
 * four were uploaded and dropped without being compared to anything. Sampling to pick the best fix
 * would be a reason to take several; sampling to pick the newest is not, because the newest is the
 * one you get by waiting.
 *
 * The saving that matters is not the ~400 bytes. It is four fewer GPS acquisitions every fifteen
 * seconds, all shift — and the GPS radio costs a driver far more battery than the request does.
 */
const FIX_INTERVAL_MS = FLUSH_INTERVAL_MS;

/**
 * How long to wait before a second attempt when a fix fails.
 *
 * At one fix per flush a failure is no longer cheap. `MongoDriverPool` drops a driver whose
 * position is over two minutes old, which is eight consecutive failures now rather than the forty
 * the 3s cadence allowed — and the driver cannot tell, because their app still says "online" while
 * no wave can see them. The retry and the cached-position fallback in `takeFix` exist to buy that
 * tolerance back without going back to sampling.
 */
const FIX_RETRY_DELAY_MS = 3_000;

/**
 * Cap on the buffer.
 *
 * Only the newest fix is stored server-side, so an unbounded buffer during a long network outage
 * would send a large body to have all but one row discarded. Oldest are dropped first.
 *
 * At one fix per flush this is twenty fixes across five minutes of outage rather than one minute —
 * the cap got more generous in wall-clock terms without changing, which is the right direction: the
 * thing being protected against is a long disconnection, and that is measured in minutes.
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

  if (override !== null) {
    push(override.lat, override.lng, new Date());
    return;
  }

  try {
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    // Wall clock, NOT `position.timestamp`. A live fix has just been acquired, so the two agree to
    // within milliseconds — but some Android devices report a boot-relative value there, and a
    // `recorded_at` far in the past silently drops the driver out of every dispatch wave while
    // their app still reads "online". The cached path below is the one case where the fix's own
    // timestamp is the right answer, because there staleness is the fact being reported.
    push(position.coords.latitude, position.coords.longitude, new Date());
    return;
  } catch {
    // A single failed fix is normal indoors, and it is no longer cheap — see FIX_RETRY_DELAY_MS.
    // Fall through to the two recoveries below rather than waiting a full interval.
  }

  /*
   * The OS's last known position, which costs NO GPS acquisition — it is whatever the platform
   * already had cached from any app.
   *
   * `recorded_at` is the cached fix's OWN timestamp, not now. That matters: a cached fix presented
   * as current would hold a driver in the dispatch pool on a position they left ten minutes ago,
   * which is exactly the failure the server's freshness window exists to prevent. Sent honestly
   * stale, it either still falls inside that window or is correctly ignored.
   */
  const cached = await Location.getLastKnownPositionAsync().catch(() => null);
  if (cached !== null) {
    push(cached.coords.latitude, cached.coords.longitude, new Date(cached.timestamp));
    return;
  }

  // Nothing cached either. One more attempt, well before the next interval — a driver walking out
  // of a basement should be dispatchable in seconds, not at the top of the next flush.
  await new Promise((resolve) => setTimeout(resolve, FIX_RETRY_DELAY_MS));

  // The driver may have gone off duty while we waited. `stopLocationPings` has already emptied the
  // buffer by then, so pushing here would resurrect a position from the end of a finished shift and
  // hand it to the next shift's first flush.
  if (fixTimer === null) return;

  try {
    const retried = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    push(retried.coords.latitude, retried.coords.longitude, new Date());
  } catch {
    // Genuinely no position available. Dropping it silently is correct; a sustained outage is the
    // server's freshness window's job to notice, not something to surface per failed fix.
  }
}

function push(lat: number, lng: number, recordedAt: Date): void {
  buffer.push({
    lat,
    lng,
    // CLIENT-supplied, and it must be: the app buffers offline and flushes on reconnect, so when
    // a fix was taken and when it arrives are different facts.
    recorded_at: recordedAt.toISOString(),
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
    /**
     * CHECK FIRST, PROMPT ONLY IF THERE IS SOMETHING TO ASK — the same rule
     * `startDutyForegroundService` follows, and for the same reason.
     * `requestForegroundPermissionsAsync` NEVER RESOLVES on ColorOS / realme UI when the
     * permission is already granted. The first call of the shift often gets away with it because
     * a dialog is genuinely shown; the SECOND call — after going off duty and back on, or a
     * resume re-arm — hangs forever, and because this function is awaited inside
     * `ensureDutyMachinery`'s single-flight guard, that one hang wedges every future recovery
     * attempt too. `getForegroundPermissionsAsync` always resolves, so it is the one on the hot
     * path; the prompting variant runs only when the grant is genuinely missing and askable.
     */
    let permission = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (permission !== null && !permission.granted && permission.canAskAgain) {
      permission = await Location.requestForegroundPermissionsAsync().catch(() => null);
    }
    if (permission === null || !permission.granted) return false;
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
