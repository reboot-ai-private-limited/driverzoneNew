import notifee, { EventType } from '@notifee/react-native';
import { getMessaging, onMessage, type RemoteMessage } from '@react-native-firebase/messaging';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ensureNotificationChannels } from './channel';
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
 *   app backgrounded  → `backgroundMessage.ts`, then `onForegroundEvent` when they tap
 *   app killed        → `backgroundMessage.ts`, then `getInitialNotification` on cold start
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

      if (data.type === 'offer.new') {
        void displayOfferNotification(data);
        if (data.offerId !== undefined) router.push(`/offer/${data.offerId}`);
        return;
      }

      if (data.type === 'offer.cancelled' && data.offerId !== undefined) {
        void cancelOfferNotification(data.offerId);
      }
    });

    /** Tapping the notification while the app is alive but backgrounded. */
    const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      if (type !== EventType.PRESS) return;
      const url = detail.notification?.data?.['url'];
      if (typeof url === 'string') router.push(url);
    });

    /**
     * Cold start FROM a notification — the app was killed, the driver tapped, and this is the
     * first render. Without this the app opens on Home and the offer they tapped is nowhere.
     */
    void notifee.getInitialNotification().then((initial) => {
      const url = initial?.notification.data?.['url'];
      if (typeof url === 'string') router.push(url);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeNotifee();
    };
  }, []);
}
