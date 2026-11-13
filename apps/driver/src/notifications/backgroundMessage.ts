import notifee from '@notifee/react-native';
import { getMessaging, setBackgroundMessageHandler, type RemoteMessage } from '@react-native-firebase/messaging';
import { rememberDutyState, teardownDutyMachinery } from '@/duty/dutyRecovery';
import { ensureNotificationChannels } from './channel';
import { pushLog } from './log';
import { handleOfferNotificationEvent } from './offerActions';
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
      return;
    }

    /**
     * The server's presence sweep took this driver off duty.
     *
     * Handled HERE as well as in the foreground bridge, and the case it covers is the common one:
     * the app is ALIVE but backgrounded — which is exactly the state the foreground service is
     * there to maintain — so this handler runs in the live JS context and the teardown is real.
     * Without it the app kept its duty flag, kept the service up and kept pinging a server that
     * had already written the driver off, showing "You're online" until they next opened it.
     *
     * Nothing is DISPLAYED here: `sendDutyEnded` carries a `notification` block, so Android has
     * already drawn the notice itself. Drawing a second one is the double-notification bug.
     */
    if (data.type === 'duty.ended') {
      await rememberDutyState(false);
      await teardownDutyMachinery();
    }
  } catch {
    // Swallowed for the reason in the header: there is nobody here to report to, and a rejection
    // buys nothing but a lost offer.
  }
});

/**
 * TAPPING THE RING WHEN THE APP IS NOT ON SCREEN — the handler whose absence made the offer
 * notification look dead.
 *
 * Notifee delivers a press to `onForegroundEvent` only while the app is actually in the
 * FOREGROUND. Every other press — backgrounded, or killed — goes to `onBackgroundEvent`, and this
 * app never registered one. Notifee received each tap, found nobody to give it to, logged
 * `no background event handler has been set` and dropped it.
 *
 * The activity still launched, because the notification carries
 * `pressAction: { launchActivity: 'default' }`. So the app opened on whatever screen it was last
 * on — Duty, usually — and the trip the driver had just tapped was nowhere. From the driver's
 * side that is "I pressed the notification and nothing happened", which is exactly how it was
 * reported. Reproduced on a realme running Android 15: app backgrounded, one live offer, tap, and
 * the log showed the warning above with no `openOffer` call at all.
 *
 * It is NOT a duplicate of the FCM handler above. That one runs when a MESSAGE arrives; this one
 * runs when a human presses the notification that message drew.
 *
 * **Registered at module scope, in this file, for the same reason as the message handler:** it
 * must exist before a press can arrive, and `index.js` imports this module before
 * `expo-router/entry`.
 *
 * TWO WORLDS, ONE HANDLER:
 *
 *   - **Backgrounded but alive** — the common case, and the one that was broken. The router is
 *     mounted, so `openOffer` routes immediately and the ring screen is already there when the
 *     activity resumes.
 *   - **Killed** — this runs headless with no navigator. `app/index.tsx` handles that case
 *     through `getInitialOfferHref()` as part of its own boot sequence. Both resolve to the same
 *     href, so the two agree rather than race.
 *
 * `fromTap` is what makes the press outrank the per-href latch in `openOffer`: a driver who
 * backed out of a still-ringing offer is asking to go back in, and the latch exists to stop a
 * poll from doing that by itself, not to stop them.
 */
notifee.onBackgroundEvent(handleOfferNotificationEvent);
