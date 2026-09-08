import { getMessaging, setBackgroundMessageHandler, type RemoteMessage } from '@react-native-firebase/messaging';
import { ensureNotificationChannels } from './channel';
import { pushLog } from './log';
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
pushLog('backgroundMessage handler registered');

setBackgroundMessageHandler(getMessaging(), async (remoteMessage: RemoteMessage) => {
  const data = (remoteMessage.data ?? {}) as unknown as OfferPushData;

  // The single most useful line in a field diagnosis: it proves FCM woke the process and what it
  // handed us. Its ABSENCE when an offer was expected points the finger squarely at the server or
  // the token, not at anything below.
  pushLog('backgroundMessage received', {
    type: data.type ?? '(none)',
    offerId: data.offerId,
    messageId: remoteMessage.messageId,
    from: remoteMessage.from,
  });

  /**
   * NOTHING IN HERE MAY THROW.
   *
   * A rejected background handler is not a logged error the driver can act on — the headless task
   * is torn down and the offer is simply never shown. There is no screen, no console and no crash
   * report on a driver's handset, so a throw is indistinguishable from a push that never arrived.
   * That made the single most important failure in the app also the least diagnosable.
   *
   * Every step is therefore isolated, and each one is allowed to fail without taking the next
   * with it: a channel that could not be created must still be attempted as a notification (it
   * may already exist from a previous launch), and a display that failed must not prevent a
   * cancellation from clearing a stale ring.
   */
  try {
    // Channels are created on every path because this may be the FIRST thing that ever ran on a
    // fresh install — the app proper may never have started, and a notification on a channel that
    // does not exist is silently dropped by Android.
    await ensureNotificationChannels();
  } catch {
    // Fall through deliberately. The channel is very likely already there from an earlier run,
    // and refusing to display on the strength of this would turn a recoverable hiccup into the
    // silence this whole file exists to prevent.
  }

  try {
    if (data.type === 'offer.new') {
      // Already internally guarded — it falls back to a plain heads-up when the full-screen ring
      // is refused. This outer catch is for everything below that: a malformed payload, a JSON
      // field that is not the shape the type claims.
      await displayOfferNotification(data);
      return;
    }

    if (data.type === 'offer.cancelled' && data.offerId !== undefined) {
      // Another driver won, or the customer cancelled. Silence immediately — a phone still ringing
      // for a trip that is gone is what teaches drivers to stop trusting the ring.
      await cancelOfferNotification(data.offerId);
    }
  } catch {
    // Swallowed for the reason in the header: there is nobody here to report to, and a rejection
    // buys nothing but a lost offer.
  }
});
