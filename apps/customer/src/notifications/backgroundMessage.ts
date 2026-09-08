import {
  getMessaging,
  setBackgroundMessageHandler,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { ensureNotificationChannels } from './channel';
import { pushLog } from './log';
import { type BookingUpdateData, displayBookingUpdate } from './pushNotification';

/**
 * THE HANDLER THAT RUNS WHEN THE APP IS BACKGROUNDED OR DEAD.
 *
 * Registered at module scope, imported from `index.js` BEFORE `expo-router/entry`. FCM wakes the
 * process in a headless state — no React, no navigation, a few seconds of life — and hands the
 * message to whatever was registered at startup. Registering this inside a component would mean
 * it only exists once the app is already running, which is the one case it is not needed for.
 *
 * NOTHING IN HERE MAY THROW. A rejected background handler is torn down silently — no screen, no
 * console the customer can see — so a throw is indistinguishable from a push that never arrived.
 * Every step is isolated.
 */
pushLog('backgroundMessage handler registered');

setBackgroundMessageHandler(getMessaging(), async (remoteMessage: RemoteMessage) => {
  const data = (remoteMessage.data ?? {}) as unknown as BookingUpdateData;

  pushLog('backgroundMessage received', {
    type: data.type ?? '(none)',
    bookingId: data.bookingId,
    messageId: remoteMessage.messageId,
  });

  try {
    await ensureNotificationChannels();
  } catch {
    // Very likely already created on an earlier run; refusing to display over this would turn a
    // recoverable hiccup into silence.
  }

  try {
    if (data.type === 'booking.updated') {
      await displayBookingUpdate(data);
    }
  } catch {
    // Swallowed: there is nobody here to report to, and a rejection buys nothing but a lost
    // notification.
  }
});
