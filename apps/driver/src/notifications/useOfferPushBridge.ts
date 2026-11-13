import notifee from '@notifee/react-native';
import { getMessaging, onMessage, type RemoteMessage } from '@react-native-firebase/messaging';
import { useEffect } from 'react';
import { rememberDutyState, teardownDutyMachinery } from '@/duty/dutyRecovery';
import { offerHref, openOffer } from '@/features/offer/openOffer';
import { ensureNotificationChannels } from './channel';
import { pushLog } from './log';
import { handleOfferNotificationEvent } from './offerActions';
import {
  cancelOfferNotification,
  displayOfferNotification,
  type OfferPushData,
} from './offerNotification';

/**
 * The bridge between a push and the ring screen, for the app's FOREGROUND life.
 *
 * `backgroundMessage.ts` is the other half and handles the case this one cannot: a killed
 * process. The two are deliberately separate because they run in different worlds — that one has
 * no React, no navigation and a few seconds of life; this one has all three.
 *
 * Between them they cover every way an offer can arrive:
 *
 *   app open          → `onMessage` here, which still shows a notification rather than assuming
 *                       the driver is looking at the phone
 *   app backgrounded  → `backgroundMessage.ts`, then its `onBackgroundEvent` when they tap —
 *                       NOT this hook's `onForegroundEvent`, which Notifee only calls while the
 *                       app is actually on screen
 *   app killed        → `backgroundMessage.ts`, then `app/index.tsx` reads
 *                        `getInitialOfferHref()` as part of its own boot sequence — NOT this
 *                        hook, which would race that screen's routing decision
 *   screen locked     → full-screen intent opens the app directly on the ring screen
 */
export function useOfferPushBridge(): void {
  useEffect(() => {
    // Must exist before anything is displayed; Android silently drops a notification posted to a
    // channel that has not been created.
    void ensureNotificationChannels();

    /**
     * A push arriving while the app is open.
     *
     * It still displays the notification rather than only navigating: the driver may be on the
     * Account tab with the phone in a pocket, and "the app is running" is not "the driver is
     * looking". The ring is the point.
     */
    const unsubscribeMessage = onMessage(getMessaging(), (remoteMessage: RemoteMessage) => {
      const data = (remoteMessage.data ?? {}) as unknown as OfferPushData;

      // Foreground counterpart of the log in `backgroundMessage.ts` — proves the push arrived
      // while the app was open, and which handler took it.
      pushLog('onMessage received (foreground)', {
        type: data.type ?? '(none)',
        offerId: data.offerId,
        messageId: remoteMessage.messageId,
      });

      if (data.type === 'offer.new') {
        void displayOfferNotification(data);
        if (data.offerId !== undefined) openOffer(offerHref(data.offerId));
        return;
      }

      if (data.type === 'offer.cancelled' && data.offerId !== undefined) {
        void cancelOfferNotification(data.offerId);
        return;
      }

      /**
       * The server's presence sweep took this driver off duty.
       *
       * Handled here as well as by Android's own rendering of the notification, because a message
       * that arrives while the app is in the FOREGROUND is delivered to this callback and is NOT
       * drawn by the system — so without this branch a running app would ignore it entirely and
       * carry on showing "You're online" over a duty flag the server has already cleared.
       *
       * That combination is exactly the case worth catching: the process survived while an OEM
       * froze the ping loop, so the flush observer in `locationPings` — the usual way a
       * server-side duty change reaches this app — never ran to notice.
       */
      if (data.type === 'duty.ended') {
        void rememberDutyState(false).then(() => teardownDutyMachinery());
      }
    });

    /**
     * Tapping the notification while the app is ON SCREEN.
     *
     * NOT the backgrounded case, which this comment used to claim. Notifee routes a press to this
     * handler only while the app is in the foreground; backgrounded and killed presses go to
     * `onBackgroundEvent`, registered in `backgroundMessage.ts`. Believing otherwise is why that
     * one did not exist and why every tap on a backgrounded app was silently dropped.
     *
     * So this covers the narrow case of a driver looking at the app and tapping the heads-up
     * banner anyway — rare, but the ring screen still has to open when they do.
     */
    const unsubscribeNotifee = notifee.onForegroundEvent((event) => {
      void handleOfferNotificationEvent(event);
    });

    /*
     * COLD START is deliberately NOT handled here. `notifee.getInitialNotification()` used to be
     * read from this effect — which runs on the very first render, before `<Stack>` exists — and
     * it raced `app/index.tsx`'s own boot sequence: that screen's unconditional `router.replace`
     * fires a few hundred milliseconds later and swaps out whatever this effect had just pushed,
     * queued or not. `index.tsx` now makes that check itself, as the one thing its single routing
     * decision depends on, which is the only way to guarantee the offer is not overwritten. See
     * `getInitialOfferHref` for the read this effect used to duplicate.
     */

    return () => {
      unsubscribeMessage();
      unsubscribeNotifee();
    };
  }, []);
}
