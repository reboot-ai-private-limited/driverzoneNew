import notifee, { EventType } from '@notifee/react-native';
import {
  getMessaging,
  setBackgroundMessageHandler,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { ensureNotificationChannels } from './channel';
import { pushLog } from './log';
import { type BookingUpdateData, displayBookingUpdate } from './pushNotification';

/**
 * THE HANDLERS THAT RUN WHEN THE APP IS BACKGROUNDED OR DEAD.
 *
 * Registered at module scope, imported from `index.js` BEFORE `expo-router/entry`. FCM wakes the
 * process in a headless state — no React, no navigation, a few seconds of life — and hands the
 * message to whatever was registered at startup.
 *
 * **The server's ride-update push carries a `notification` block.** When the app is backgrounded
 * or quit, ANDROID ITSELF draws that — a system notification, on the channel named in
 * `firebase.json`. So this handler must NOT call `displayBookingUpdate` in that case, or the
 * customer sees the same update twice (once from the system, once from Notifee). It only draws
 * one itself for a hypothetical data-only message, which the server does not currently send.
 *
 * The tap on that system notification is picked up by `messaging().onNotificationOpenedApp()` /
 * `getInitialNotification()` in `useNotificationBridge`, not by Notifee — Notifee did not create
 * it.
 *
 * NOTHING IN HERE MAY THROW: a rejected background handler is torn down silently.
 */
pushLog('backgroundMessage handler registered');

setBackgroundMessageHandler(getMessaging(), async (remoteMessage: RemoteMessage) => {
  const data = (remoteMessage.data ?? {}) as unknown as BookingUpdateData;

  pushLog('backgroundMessage received', {
    type: data.type ?? '(none)',
    bookingId: data.bookingId,
    hasNotification: remoteMessage.notification !== undefined,
    messageId: remoteMessage.messageId,
  });

  try {
    // Always — this may be the FIRST thing that ever ran on a fresh install, and Android drops a
    // system notification posted (by FCM, from the `notification` block) to a channel that does
    // not exist yet.
    await ensureNotificationChannels();

    // A message that carries a `notification` block is already on screen, drawn by Android. Only
    // a data-only message needs us to draw it — the server does not send those today, but the
    // branch is here so a future one is not silently dropped.
    if (remoteMessage.notification === undefined && data.type === 'booking.updated') {
      await displayBookingUpdate(data);
    }
  } catch {
    // Swallowed: there is nobody here to report to, and a rejection buys nothing but a lost
    // notification.
  }
});

/**
 * Notifee's background counterpart. Required for the library to stop warning, and it is where a
 * tap on a NOTIFEE-created notification (the app was in the background when it fired) is handled.
 * Kept minimal — navigation from a cold/background tap goes through the boot screen reading
 * `getInitialNotificationHref()`, so this only has to not crash.
 */
notifee.onBackgroundEvent(async ({ type, detail }) => {
  if (type === EventType.PRESS) {
    pushLog('notifee background press', { url: detail.notification?.data?.['url'] });
  }
});
