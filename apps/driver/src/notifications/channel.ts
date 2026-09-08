import notifee, { AndroidImportance, AndroidVisibility } from '@notifee/react-native';
import { Platform } from 'react-native';

/**
 * The notification channels, created once at startup.
 *
 * **A channel's sound and importance are IMMUTABLE after first creation.** Android fixes them the
 * first time the app runs and ignores every later change — so the id carries a version. Changing
 * the tone or the importance means creating `offer-ring-v2` and migrating; editing this and
 * reinstalling on your own phone will look like it worked and will not work on anyone else's.
 */

/**
 * The ringing trip offer. Everything about it exists to be impossible to miss.
 *
 * **v2 — bumped 2026-09-08.** A channel's sound and importance are frozen on first creation, so
 * the only way to change either on a handset that already has the app is a new id. `v1` on at
 * least one test device (realme, Android 15) ended up with `bypassDnd=false` and its behaviour
 * could not be corrected in place. `v2` is a clean channel; `v1` is deleted below so it does not
 * linger in the app's notification settings as a dead entry.
 */
export const OFFER_CHANNEL_ID = 'offer-ring-v2';
const OFFER_CHANNEL_ID_V1 = 'offer-ring-v1';

/**
 * The quiet "you're online" notice that anchors the foreground service (S-8).
 *
 * LOW importance on purpose: it is on screen for the whole shift, so it must never make a sound
 * or a heads-up banner. It is not decoration — Android requires a visible notification for a
 * foreground service, and dismissing it kills the service. See `duty/dutyForegroundService.ts`.
 */
export const DUTY_CHANNEL_ID = 'duty-status';

/**
 * "You have been taken offline" — the server's presence sweep telling a driver their shift ended
 * without them.
 *
 * A SEPARATE CHANNEL FROM `DUTY_CHANNEL_ID`, and the separation is the whole point. That one is
 * deliberately LOW because it anchors the foreground service and sits on screen for an entire
 * shift, so it must never make a sound. Sending this alert on it would inherit that silence — and
 * a silent notice is worthless for the one message a driver genuinely has to notice: it arrives
 * while their app is dead, saying the reason they have had no work for the last hour.
 *
 * DEFAULT rather than HIGH: it earns a sound and a tray entry, not a heads-up banner that covers
 * what the driver is doing. The shift has already ended — this is important, not urgent. HIGH is
 * reserved for the ring, which is the only genuinely time-critical thing this app sends.
 */
export const DUTY_ALERT_CHANNEL_ID = 'duty-alert-v1';

export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // Retire the v1 offer channel. Harmless if it was never created; keeps the app's notification
  // settings from showing a stale "Trip offers" row the driver could mistakenly tune.
  await notifee.deleteChannel(OFFER_CHANNEL_ID_V1).catch(() => undefined);

  await notifee.createChannel({
    id: OFFER_CHANNEL_ID,
    name: 'Trip offers',
    description: 'The alert when a customer books and a trip is offered to you.',
    importance: AndroidImportance.HIGH,

    /*
     * `offer_ring` — the filename in `res/raw`, without its extension. The config plugin in
     * `plugins/withOfferSound.js` is what puts it there; without that this silently falls back
     * to the default notification sound.
     */
    sound: 'offer_ring',

    vibration: true,
    vibrationPattern: [300, 500, 300, 500],

    /*
     * Ring through Do Not Disturb. A driver on duty has usually silenced their phone for
     * everything else, and a trip offer is the one thing that must still get through. Needs
     * `ACCESS_NOTIFICATION_POLICY` plus the driver granting DND access — Android ignores this
     * flag rather than failing when they have not, which is the right degradation.
     */
    bypassDnd: true,

    // Show the content on the lock screen. A driver should not have to unlock to see what the
    // trip pays before deciding.
    visibility: AndroidVisibility.PUBLIC,

    lights: true,
  });

  await notifee.createChannel({
    id: DUTY_CHANNEL_ID,
    name: 'Duty status',
    description: 'The persistent notice shown while you are online.',
    importance: AndroidImportance.LOW,
  });

  /*
   * Created here alongside the others, which means on EVERY startup path including the headless
   * one — and that matters more for this channel than for either of the above. The notification
   * that uses it is drawn by Android from a `notification` payload with no app code running, and
   * Android silently drops a notification posted to a channel that does not exist. If this were
   * created lazily, the first duty-ended alert after an install would vanish — and it is sent
   * precisely when the app is not running to create anything.
   */
  await notifee.createChannel({
    id: DUTY_ALERT_CHANNEL_ID,
    name: 'Duty alerts',
    description: 'Tells you when you have been taken offline and stopped receiving trips.',
    importance: AndroidImportance.DEFAULT,
  });
}
