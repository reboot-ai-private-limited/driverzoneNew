import notifee, { AndroidImportance } from '@notifee/react-native';
import { Platform } from 'react-native';

/**
 * The notification channel, created once at startup.
 *
 * **A channel's sound and importance are IMMUTABLE after first creation.** Android fixes them the
 * first time the app runs and ignores every later change — so the id carries a version. Changing
 * the tone or the importance means creating `booking-updates-v2` and migrating.
 *
 * ONE channel, `DEFAULT` importance. The customer app has nothing like the driver app's ringing
 * trip offer: these are "your driver is arriving", "trip started", "trip completed" — worth a
 * sound and a tray entry, not a heads-up banner that covers what the customer is doing, and
 * never a full-screen alarm. `firebase.json` names this same id as
 * `messaging_android_notification_channel_id` so a stray `notification`-payload message from the
 * server lands here too rather than on a channel Android invents.
 */
export const BOOKING_CHANNEL_ID = 'booking-updates-v1';

export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  await notifee.createChannel({
    id: BOOKING_CHANNEL_ID,
    name: 'Ride updates',
    description: 'Driver assigned, arriving, trip started and completed.',
    importance: AndroidImportance.DEFAULT,
    vibration: true,
  });
}
