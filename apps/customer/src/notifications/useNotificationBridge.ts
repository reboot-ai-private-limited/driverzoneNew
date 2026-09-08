import notifee, { EventType } from '@notifee/react-native';
import { getMessaging, onMessage, type RemoteMessage } from '@react-native-firebase/messaging';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth/SessionProvider';
import { ensureNotificationChannels } from './channel';
import { pushLog } from './log';
import { registerForPush } from './registerDevice';
import { type BookingUpdateData, displayBookingUpdate } from './pushNotification';

/**
 * The bridge between a push and the app, for the app's FOREGROUND life.
 *
 * `backgroundMessage.ts` is the other half — a headless process with no React and a few seconds
 * of life. This one runs in the root layout so it outlives any single screen: the channel must
 * exist before the first push can be shown, and a tap can land here when no screen of ours has
 * mounted.
 *
 * It also owns push REGISTRATION for the app. There is no "go on duty" moment like the driver
 * app's — a customer should be reachable for ride updates the whole time they are signed in — so
 * registration is tied to the session becoming `authenticated`.
 */
export function useNotificationBridge(): void {
  const status = useSession().status;

  useEffect(() => {
    void ensureNotificationChannels();
  }, []);

  // Register whenever the session is authenticated. `registerForPush` is rate-limited internally,
  // so this firing on every auth transition costs one comparison after the first success.
  useEffect(() => {
    if (status === 'authenticated') void registerForPush();
  }, [status]);

  useEffect(() => {
    /**
     * A push arriving while the app is OPEN. Still shown as a notification rather than only acted
     * on silently — the customer may have the phone in a pocket while waiting for the driver.
     */
    const unsubscribeMessage = onMessage(getMessaging(), (remoteMessage: RemoteMessage) => {
      const data = (remoteMessage.data ?? {}) as unknown as BookingUpdateData;
      pushLog('onMessage received (foreground)', {
        type: data.type ?? '(none)',
        bookingId: data.bookingId,
      });
      if (data.type === 'booking.updated') void displayBookingUpdate(data);
    });

    /** Tapping the notification while the app is alive. */
    const unsubscribeNotifee = notifee.onForegroundEvent(({ type, detail }) => {
      if (type !== EventType.PRESS) return;
      const url = detail.notification?.data?.['url'];
      if (typeof url === 'string') router.push(url as never);
    });

    return () => {
      unsubscribeMessage();
      unsubscribeNotifee();
    };
  }, []);
}

/**
 * The deep link carried by a notification the customer tapped to OPEN the app from cold.
 *
 * Read once, from the boot screen, before it makes its own routing decision — the same pattern
 * the driver app uses, and for the same reason: reading it from a layout effect races the boot
 * screen's `router.replace`.
 */
export async function getInitialNotificationHref(): Promise<string | null> {
  const initial = await notifee.getInitialNotification();
  const url = initial?.notification.data?.['url'];
  return typeof url === 'string' ? url : null;
}
