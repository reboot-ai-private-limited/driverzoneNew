import { getMessaging, setBackgroundMessageHandler, type RemoteMessage } from '@react-native-firebase/messaging';
import { ensureNotificationChannels } from './channel';
import { cancelOfferNotification, displayOfferNotification, type OfferPushData } from './offerNotification';

/**
 * THE HANDLER THAT RUNS WHEN THE APP IS DEAD.
 *
 * Registered at module scope, imported from `index.js` BEFORE `expo-router/entry`. That ordering
 * is the whole point: FCM wakes the process in a headless state with no React, no navigation and
 * no screens, and hands the message to whatever was registered at startup. Registering this
 * inside a component would mean it only exists once the app is already running — which is the one
 * case it is not needed for.
 *
 * It must stay small and synchronous-ish. The OS grants a headless task a few seconds; anything
 * that waits on the network here risks being killed mid-ring.
 */
setBackgroundMessageHandler(getMessaging(), async (remoteMessage: RemoteMessage) => {
  const data = (remoteMessage.data ?? {}) as unknown as OfferPushData;

  // Channels are created on every path because this may be the FIRST thing that ever ran on a
  // fresh install — the app proper may never have started, and a notification on a channel that
  // does not exist is silently dropped by Android.
  await ensureNotificationChannels();

  if (data.type === 'offer.new') {
    await displayOfferNotification(data);
    return;
  }

  if (data.type === 'offer.cancelled' && data.offerId !== undefined) {
    // Another driver won, or the customer cancelled. Silence immediately — a phone still ringing
    // for a trip that is gone is what teaches drivers to stop trusting the ring.
    await cancelOfferNotification(data.offerId);
  }
});
