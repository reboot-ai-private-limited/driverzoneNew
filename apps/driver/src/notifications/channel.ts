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

/** The ringing trip offer. Everything about it exists to be impossible to miss. */
export const OFFER_CHANNEL_ID = 'offer-ring-v1';

/** The quiet "you're online" notice that will accompany the foreground service (S-8). */
export const DUTY_CHANNEL_ID = 'duty-status';

export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

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
}
