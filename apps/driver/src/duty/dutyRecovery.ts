import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { setSessionEndHook } from '@/lib/auth/session';
import { pushLog } from '@/notifications/log';
import { registerForPush } from '@/notifications/registerDevice';
import {
  isDutyServiceRunning,
  startDutyForegroundService,
  stopDutyForegroundService,
} from './dutyForegroundService';
import { isPinging, startLocationPings, stopLocationPings } from './locationPings';

/**
 * BRINGING A KILLED APP BACK ON DUTY — docs/LLD/driver-app.md S-8, the half S-1 says cannot be
 * engineered around and the half that can.
 *
 * The foreground service keeps the process resident, and that is most of the battle. It is not all
 * of it: Android still reclaims a backgrounded app under memory pressure, which on the 3–4 GB
 * handsets that make up much of this market happens routinely and has nothing to do with the OEM.
 * When it does, every piece of machinery that makes a driver dispatchable dies with the process —
 * the ping loop, the FCM registration, the service itself — while `isOnDuty` stays true on the
 * server. The driver looks online to dispatch and receives nothing.
 *
 * **Why this is not the Home screen's job any more.** `home.tsx` already re-armed all three in a
 * `useEffect`, and that covered the common case: killed while idle, reopened, lands on Home. It
 * missed two that are not rare at all.
 *
 *   - KILLED MID-TRIP. `gate.tsx` routes a recovered trip straight to `/trip/[id]`, so Home never
 *     mounts and its effect never runs. The driver is on a live job, with a customer waiting, and
 *     is invisible to dispatch for the rest of it.
 *   - RESUMED RATHER THAN RELAUNCHED. The effect keys on `onDuty`, so when the app is frozen and
 *     thawed — the OEM battery managers' favourite move — the value never changes and nothing
 *     re-runs, even though the service may have been torn down while the process slept.
 *
 * So the logic lives here, in a module with no React in it, and is driven by the two events that
 * actually correlate with "the machinery may be gone": the app booting, and the app returning to
 * the foreground.
 *
 * **What it deliberately does NOT try to do: survive a force-stop or a reboot on its own.** Both
 * leave the process dead with no code of ours running, and Android offers no way back that does
 * not involve the driver opening the app or a push waking it (S-1). The server-side presence sweep
 * is the backstop for that, not this file.
 */

/**
 * Duty, remembered across launches.
 *
 * Duty is SERVER state and the profile is the source of truth — but the profile costs a
 * round-trip, and this needs to act before one completes. A driver whose app was killed mid-shift
 * should be pinging again within a second of reopening it, not after a request that may itself be
 * waiting on the signal that just came back.
 *
 * Namespaced `dz.driver.*` like the refresh token and the battery flags. In SecureStore for
 * consistency with those rather than for secrecy — there is nothing sensitive about a boolean.
 */
const DUTY_KEY = 'dz.driver.on_duty';

/** The in-memory copy, so the hot paths below never wait on storage. */
let onDuty = false;

/**
 * Record what the server says about duty, in memory and on disk.
 *
 * Called from the duty toggle, and from the ping loop's observer whenever the server answers a
 * flush — so a driver taken off duty server-side is reflected here within one ping rather than at
 * the next cold start.
 */
export async function rememberDutyState(next: boolean): Promise<void> {
  onDuty = next;
  try {
    await SecureStore.setItemAsync(DUTY_KEY, next ? '1' : '0');
  } catch {
    // The in-memory copy still holds for this process. Worst case a kill loses the memory and the
    // profile query re-establishes it a moment later, which is the behaviour that existed before
    // this file.
  }
}

async function readRememberedDuty(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(DUTY_KEY)) === '1';
  } catch {
    // A broken keystore must not wedge a launch. `false` means the profile query decides, exactly
    // as it did before.
    return false;
  }
}

/**
 * The server's answer on every flush, forwarded to the ping loop as its observer.
 *
 * The `false` branch is what stops a driver ending a shift from another device — or being taken
 * off duty by an admin — from leaving a foreground service and a ping loop running on this one.
 */
function onServerDutyChange(isOnDuty: boolean): void {
  if (isOnDuty) {
    void rememberDutyState(true);
    return;
  }
  void rememberDutyState(false).then(() => teardownDutyMachinery());
}

/**
 * What `ensureDutyMachinery` managed to bring up.
 *
 * Returned rather than thrown, and rather than swallowed, because the duty screen is the one place
 * a driver can act on it — `no-location` and `no-service` each have a different sentence to say and
 * a different setting to fix. The background callers ignore the value; only the toggle renders it.
 */
export type DutyMachineryResult = 'ok' | 'idle' | 'no-location' | 'no-service' | 'timeout';

/**
 * Bring everything a driver needs to receive work up to match `onDuty`. Idempotent, and safe to
 * call as often as you like — which is the point, since the callers below fire on every resume.
 *
 * ORDER IS LOAD-BEARING, and it is the same rule the duty toggle follows: the location grant must
 * exist before a `location`-typed foreground service may be started, or Android throws
 * `SecurityException` natively inside `onStartCommand` — uncatchable from JS — and takes the whole
 * process down. Pings first, service second.
 *
 * Push registration is fired without awaiting: it reaches Firebase's `getToken()`, a network call
 * with no timeout of its own, and nothing below depends on it.
 */
let ensureInFlight: Promise<DutyMachineryResult> | null = null;

export function ensureDutyMachinery(): Promise<DutyMachineryResult> {
  // Coalesce. Boot, the Home effect and the resume listener all call this, often within the same
  // tick — without this each one independently walks the start sequence, and the duplicate
  // `startDutyForegroundService` calls are what re-post the duty notice and flicker the shade.
  if (ensureInFlight !== null) return ensureInFlight;

  /**
   * A hung inner must NOT wedge every future call. `ensureDutyMachineryInner` awaits native
   * permission and foreground-service calls that have been known to never resolve on some OEM
   * skins; without this, one such hang left the coalescing slot occupied for the life of the
   * process and no resume, toggle or re-arm could ever start the machinery again. The race
   * releases the slot after 20s so the next caller gets a fresh attempt — the timeout result is
   * discarded, and a genuinely-slow inner that finishes later still cleans up after itself.
   */
  ensureInFlight = Promise.race([
    ensureDutyMachineryInner(),
    new Promise<DutyMachineryResult>((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
  ]).finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

async function ensureDutyMachineryInner(): Promise<DutyMachineryResult> {
  if (!onDuty) return 'idle';

  pushLog('ensureDutyMachinery', {
    pinging: isPinging(),
    service: isDutyServiceRunning(),
  });

  if (!isPinging()) {
    const started = await startLocationPings(onServerDutyChange);
    // No location grant means the service cannot legally start either. Bail rather than crash.
    if (!started) {
      pushLog('ensureDutyMachinery: no location grant');
      return 'no-location';
    }
  }

  const serviceUp = await startDutyForegroundService();

  // Re-registering matters more here than anywhere: a token is per-install, and a driver restored
  // onto a fresh install would otherwise be on duty with none, so dispatch logs "driver has no
  // registered device" and every offer lapses in silence. `$addToSet` server-side makes it free.
  // Check-only: this runs with no screen to explain a prompt from — see `registerForPush`.
  void registerForPush(false, false);

  return serviceUp ? 'ok' : 'no-service';
}

/** Stop everything. Safe when nothing is running. */
export async function teardownDutyMachinery(): Promise<void> {
  stopLocationPings();
  await stopDutyForegroundService();
}

/**
 * Called once per launch, from the boot screen, after the session is known to be good.
 *
 * AFTER the session, not before: both the ping flush and the device registration are authenticated
 * calls, and firing them against a session that has not been restored yet would spend the client's
 * one 401 retry on a request that was always going to be early.
 */
export async function restoreDutyMachinery(): Promise<void> {
  onDuty = await readRememberedDuty();
  await ensureDutyMachinery();
}

/**
 * THE RESUME HOOK, registered at module scope so it lives as long as the process rather than as
 * long as a screen — the same reasoning as the FCM handler and the foreground-service task.
 *
 * `active` is the moment to check, because it is the first instant we are allowed to do anything
 * about a service that was torn down while we were frozen.
 *
 * DEBOUNCED. Android fires `active` more than once around a resume — through the lock screen, a
 * permission dialog, the recents switcher — and each one used to walk the whole start sequence.
 * `ensureDutyMachinery` now coalesces, but the debounce also collapses the burst so the common
 * case is a single pass a beat after the app settles.
 */
let resumeTimer: ReturnType<typeof setTimeout> | null = null;
AppState.addEventListener('change', (next) => {
  if (next !== 'active') return;
  if (resumeTimer !== null) clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    // Only do work if something is actually down. When on duty with the service up and the ping
    // loop running, there is nothing to re-arm — and calling `ensureDutyMachinery` anyway was
    // half of the feedback loop that re-posted the duty notice on every resume.
    if (!onDuty) return;
    if (isDutyServiceRunning() && isPinging()) return;
    pushLog('resume: duty machinery is down, re-arming');
    void ensureDutyMachinery();
  }, 1000);
});

/**
 * STOP EVERYTHING WHEN THE SESSION ENDS, registered at module scope like the resume listener
 * above and for the same reason: this must be in place before anything can end a session, and a
 * hook installed by a screen would miss the case that matters most — a refresh rejected while the
 * app sits on Home or a live trip.
 *
 * REGISTERED FROM THIS SIDE, not imported from `session.ts`. This module reaches the API through
 * `notifications/registerDevice` → `lib/api/endpoints/driver`, which imports `session.ts` for the
 * access token; importing duty back from there closed a require cycle that Metro warned about on
 * every launch. The same inversion `client.ts` uses for `setTokenRefresher`.
 *
 * `rememberDutyState(false)` BEFORE the teardown. The remembered flag is what
 * `restoreDutyMachinery()` reads on the next launch, so leaving it `true` would bring the whole
 * apparatus back up at the login screen, for a driver with no session to ping with.
 */
setSessionEndHook(async () => {
  await rememberDutyState(false);
  await teardownDutyMachinery();
});
