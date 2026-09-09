import notifee, {
  AndroidForegroundServiceType,
  AndroidVisibility,
} from '@notifee/react-native';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { DUTY_CHANNEL_ID } from '@/notifications/channel';
import { pushLog } from '@/notifications/log';

/**
 * THE FOREGROUND SERVICE — docs/LLD/driver-app.md S-8.
 *
 * The difference between a driver app that receives offers and one that doesn't.
 *
 * **What it buys.** A normal backgrounded app — screen locked, or swiped from recents — is frozen
 * or killed within seconds on Xiaomi / Oppo / Vivo / Realme, which is most of this market. A dead
 * process holds no socket, runs no poll, and (per docs/LLD/dispatch-and-assignment.md
 * §"Notification delivery") receives FCM minutes late or not at all. A foreground service is the
 * deal Android offers instead: post a permanent, user-visible notification and the OS treats the
 * process as ongoing work rather than something to reclaim. That moves the app from the bottom of
 * the S-1 table to the middle row.
 *
 * It also does two jobs nothing else can:
 *   - keeps `locationPings` running while the screen is off, so the driver does not age out of
 *     `MongoDriverPool`'s two-minute freshness window and silently stop being offered trips;
 *   - is the only way Android grants continuous location to a backgrounded app at all — hence
 *     `FOREGROUND_SERVICE_TYPE_LOCATION` below and the matching manifest type in
 *     `plugins/withDutyForegroundService.js`.
 *
 * **What it does NOT buy: force-stop.** If the driver hits "Force stop", or an OEM "clear-all +
 * lock" sweeps the app, no code runs and no service survives. That is an OS guarantee, not
 * something to engineer around (S-1) — which is why the server-side presence sweeper (S-16.4)
 * exists to notice a silent driver and tell them they have gone offline.
 *
 * **Registration happens at module scope**, at the bottom of this file, and `index.js` imports it
 * for that side effect alone. Notifee hands the task to a service that Android can recreate on its
 * own, with no React mounted, so a task registered inside a component would not exist at the
 * moment it is needed. It is a bare import rather than a call in `index.js` because ES imports
 * hoist: a call placed between two imports runs AFTER both of them, which would have put this
 * after `expo-router/entry` — the opposite of what the ordering there is for.
 */

/** One id, so a restart replaces the notice rather than stacking a second one. */
const DUTY_NOTIFICATION_ID = 'duty-status';

/**
 * Whether THIS process currently believes the service is up.
 *
 * The guard that stops the status-bar flicker. `startDutyForegroundService` is now called from
 * three places — the boot screen, the Home screen's effect, and the app-resume listener — and
 * each `notifee.displayNotification({ asForegroundService: true })` re-invokes `startForeground()`
 * natively, which tears the persistent notification down and re-posts it. On a resume all three
 * fired inside a second, so the OS re-posted the notice 7–9 times in a row and the shade
 * flickered. It also restarts Notifee's own sound player, which is why a trip offer arriving in
 * that window could stutter into silence.
 *
 * Reset whenever the service is stopped, or when Android reports it is no longer displayed.
 */
let serviceRunning = false;

/** Coalesces concurrent starts — three callers on one resume must do one `displayNotification`. */
let startInFlight: Promise<boolean> | null = null;

/**
 * Resolves the task promise, which is how the service is allowed to end.
 *
 * Held at module scope rather than in a closure per start: `registerForegroundService` is called
 * exactly once for the process, and its task may be re-entered if Android recreates the service.
 */
let releaseTask: (() => void) | null = null;

/**
 * Register the long-running task. Idempotent per process; call it once from `index.js`.
 *
 * The task's promise deliberately NEVER resolves on its own. Notifee keeps the service alive for
 * exactly as long as this promise is pending, so resolving early would let Android reclaim the
 * process mid-shift — the precise failure this file exists to prevent. It is resolved only by
 * `stopDutyForegroundService`, i.e. when the driver goes off duty.
 */
export function registerDutyForegroundService(): void {
  if (Platform.OS !== 'android') return;

  notifee.registerForegroundService(
    () =>
      new Promise<void>((resolve) => {
        releaseTask = resolve;
      }),
  );
}

/**
 * Go on duty, at the OS level.
 *
 * `asForegroundService` is what promotes the notification from a notice into the service's
 * anchor. `ongoing` stops a swipe dismissing it — dismissing it would kill the service, and a
 * driver who tidied their shade would go invisible to dispatch without being told.
 *
 * Failure is reported rather than thrown: duty already succeeded server-side by the time this
 * runs, and a driver whose service could not start is still better off working with the app open
 * than being bounced back off duty. The caller surfaces the returned message.
 */
export async function startDutyForegroundService(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  /**
   * Already up in this process — return immediately, touch nothing.
   *
   * The flag is the ONLY source of truth here, and that is deliberate. The first version of this
   * guard cross-checked `notifee.getDisplayedNotifications()` and re-posted when the duty notice
   * was not in the list — but a FOREGROUND-SERVICE notification does not reliably appear in that
   * list (confirmed on realme / Android 15: the check fired "notice gone" 0.6s after a successful
   * start). The result was a re-post on every call, which re-invoked `startForeground()`, which
   * briefly churned the app's foreground state, which re-fired the app-resume listener that calls
   * this — a ~1/second feedback loop that also spammed `registerForPush` and kept tearing down
   * Notifee's audio context so an offer never actually rang.
   *
   * `serviceRunning` is cleared in exactly two places: `stopDutyForegroundService` (the driver
   * went off duty) and the `catch` in `startDutyForegroundServiceInner` (the start genuinely
   * failed). If Android silently kills the service some other way, the next cold start's
   * `restoreDutyMachinery` re-establishes it — that path does not depend on this flag.
   */
  if (serviceRunning) return true;

  // Coalesce concurrent callers onto one start.
  if (startInFlight !== null) return startInFlight;
  startInFlight = startDutyForegroundServiceInner().finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

async function startDutyForegroundServiceInner(): Promise<boolean> {
  /**
   * THE GUARD THAT KEEPS THIS FROM KILLING THE APP.
   *
   * A `location`-typed foreground service needs BOTH `FOREGROUND_SERVICE_LOCATION` (a manifest
   * grant, always present) AND a live runtime grant of `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`.
   * Start it without the second and Android throws `SecurityException` from
   * `ForegroundService.onStartCommand` — NATIVELY and ASYNCHRONOUSLY, so it never reaches the
   * `catch` below and takes the whole process down instead. On a fresh install that is a crash
   * loop on the first "Go on duty", which is exactly how this was found.
   *
   * HANDLED HERE rather than delegated to `startLocationPings()`, because that function skips the
   * permission prompt entirely when `EXPO_PUBLIC_DEV_FIXED_LAT/LNG` are set — it reports a fixed
   * coordinate and never touches GPS. The service still needs the real grant (Android gates the
   * service TYPE, not the coordinate source), so a dev build with the override would otherwise
   * never be able to start it at all.
   *
   * CHECK FIRST, PROMPT ONLY IF NEEDED, and that order is load-bearing:
   * `requestForegroundPermissionsAsync` never resolves on ColorOS when the permission is ALREADY
   * granted, which wedged this function silently — no crash, no log, the service simply never
   * started. `getForegroundPermissionsAsync` always resolves, so it is the one on the hot path;
   * the prompting variant runs only when there is genuinely something to ask.
   */
  let permission = await Location.getForegroundPermissionsAsync().catch(() => null);
  if (permission !== null && !permission.granted && permission.canAskAgain) {
    permission = await Location.requestForegroundPermissionsAsync().catch(() => null);
  }
  if (permission === null || !permission.granted) return false;

  /**
   * BACKGROUND LOCATION — asked for, never required.
   *
   * The service runs on the foreground grant alone: while a `location`-typed foreground service is
   * up, Android counts the app as "in use" and hands it fixes. So this is NOT what makes the
   * running service work, and duty must never be blocked on it.
   *
   * It is what makes the service RESTARTABLE. The two paths that bring a driver back after the OS
   * has reclaimed the process — the boot receiver, and re-arming from a background wake — both
   * start the service from a background context, and there the foreground grant is not enough:
   * Android refuses the location type and the restart fails silently, leaving a driver who looks
   * on duty to dispatch and receives nothing.
   *
   * Fired and forgotten, deliberately. On Android 11+ this is not a dialog but a trip to the
   * system settings page for "Allow all the time"; awaiting it would hang the duty toggle behind
   * a screen the driver may never come back from. A refusal costs the restart path, not the shift.
   */
  void Location.getBackgroundPermissionsAsync()
    .then((background) => {
      if (background.granted || !background.canAskAgain) return;
      return Location.requestBackgroundPermissionsAsync().then(() => undefined);
    })
    .catch(() => {
      // Never granted, never asked again, or an OEM that does not expose the setting. The service
      // still runs; only the restart path is weaker.
    });

  try {
    await notifee.displayNotification({
      id: DUTY_NOTIFICATION_ID,
      title: "DriverZone — you're online",
      body: 'Trip offers will ring on this phone.',
      android: {
        channelId: DUTY_CHANNEL_ID,
        asForegroundService: true,

        /*
         * Android 14+ refuses to start a typed foreground service unless the type is declared in
         * the manifest AND held as a runtime permission. Both halves are wired: the manifest
         * attribute in `plugins/withDutyForegroundService.js`, the `FOREGROUND_SERVICE_LOCATION`
         * permission in `app.json`. Declaring it here alone would throw at `startForeground`.
         */
        foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION],

        ongoing: true,
        autoCancel: false,
        // Tapping it returns to the app rather than doing nothing, which is what a driver expects
        // of a notification that is on their screen for the whole shift.
        pressAction: { id: 'default', launchActivity: 'default' },
        // The lock screen shows "you're online" and nothing else worth hiding.
        visibility: AndroidVisibility.PUBLIC,
      },
    });
    serviceRunning = true;
    pushLog('duty FGS: started');
    return true;
  } catch (cause) {
    // Notification permission refused, or an OEM that blocks the service outright. Not fatal.
    pushLog('duty FGS: start failed', { error: String(cause) });
    return false;
  }
}

/** Whether THIS process has the duty foreground service up. Cheap — just the flag. */
export function isDutyServiceRunning(): boolean {
  return serviceRunning;
}

/** Go off duty. Stops the service and clears the notice; safe when nothing is running. */
export async function stopDutyForegroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;

  serviceRunning = false;

  // Resolve the task first so Notifee's own stop has nothing left holding the service open.
  releaseTask?.();
  releaseTask = null;

  try {
    await notifee.stopForegroundService();
  } catch {
    // Already stopped, or never started. Nothing to do — and throwing here would break a
    // "go off duty" the driver has already been told succeeded.
  }

  try {
    await notifee.cancelNotification(DUTY_NOTIFICATION_ID);
  } catch {
    // Same: the notice is gone either way.
  }
}

// The side effect `index.js` imports this file for. See the note in the header on why it is here
// rather than a call in the entry point.
registerDutyForegroundService();
