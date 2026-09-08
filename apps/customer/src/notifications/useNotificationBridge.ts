import notifee, { EventType } from '@notifee/react-native';
import {
  getInitialNotification,
  getMessaging,
  onMessage,
  onNotificationOpenedApp,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth/SessionProvider';
import { ensureNotificationChannels } from './channel';
import { pushLog } from './log';
import { registerForPush } from './registerDevice';
import {
  type BookingUpdateData,
  bookingHref,
  displayBookingUpdate,
} from './pushNotification';

/**
 * The bridge between a push and the app, for the app's FOREGROUND life, plus the taps that bring
 * it back from the background.
 *
 * `backgroundMessage.ts` is the headless half. Between them:
 *
 *   app open           → `onMessage` here → Notifee draws the notification (the system does NOT
 *                        auto-draw a `notification` block while the app is foregrounded)
 *   app backgrounded   → Android draws the server's `notification` block itself; tapping it fires
 *                        `onNotificationOpenedApp` here
 *   app quit           → same, and the tap that launched the app is read once from
 *                        `getInitialNotification` — exposed as `getInitialNotificationHref` for
 *                        the boot screen
 *
 * It also owns push REGISTRATION: a customer is reachable for the whole time they are signed in,
 * so registration is tied to the session becoming `authenticated`.
 */
export function useNotificationBridge(): void {
  const status = useSession().status;

  useEffect(() => {
    void ensureNotificationChannels();
  }, []);

  useEffect(() => {
    if (status === 'authenticated') void registerForPush();
  }, [status]);

  useEffect(() => {
    const messaging = getMessaging();

    /** A push while the app is OPEN — draw it, the system will not. */
    const unsubscribeMessage = onMessage(messaging, (remoteMessage: RemoteMessage) => {
      const data = (remoteMessage.data ?? {}) as unknown as BookingUpdateData;
      pushLog('onMessage received (foreground)', { type: data.type ?? '(none)', bookingId: data.bookingId });
      if (data.type === 'booking.updated') void displayBookingUpdate(data);
    });

    /** Tapping the system notification while the app was in the BACKGROUND. */
    const unsubscribeOpened = onNotificationOpenedApp(messaging, (remoteMessage: RemoteMessage) => {
      const href = hrefFor(remoteMessage);
      pushLog('notification opened app (background)', { href });
      if (href !== null) router.push(href as never);
    });

    /** Tapping a NOTIFEE-drawn notification while the app is alive (foreground path). */
    const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      if (type !== EventType.PRESS) return;
      const url = detail.notification?.data?.['url'];
      if (typeof url === 'string') router.push(url as never);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeOpened();
      unsubscribeNotifee();
    };
  }, []);
}

/** The deep link for an FCM message, from its `data.url` or reconstructed from `data.bookingId`. */
function hrefFor(remoteMessage: RemoteMessage): string | null {
  const data = (remoteMessage.data ?? {}) as Record<string, unknown>;
  if (typeof data['url'] === 'string') return data['url'];
  if (typeof data['bookingId'] === 'string') return bookingHref(data['bookingId']);
  return null;
}

/**
 * The deep link carried by the notification the customer tapped to OPEN the app from cold.
 *
 * Read ONCE, from the boot screen, before it makes its own routing decision — reading it from a
 * layout effect would race the boot screen's `router.replace`. `getInitialNotification` covers
 * the system notification (the common case); `notifee.getInitialNotification` covers the rarer
 * one Notifee itself posted while the process was dead.
 */
export async function getInitialNotificationHref(): Promise<string | null> {
  const fcmInitial = await getInitialNotification(getMessaging()).catch(() => null);
  if (fcmInitial !== null) {
    const href = hrefFor(fcmInitial);
    if (href !== null) return href;
  }

  const notifeeInitial = await notifee.getInitialNotification().catch(() => null);
  const url = notifeeInitial?.notification.data?.['url'];
  return typeof url === 'string' ? url : null;
}
