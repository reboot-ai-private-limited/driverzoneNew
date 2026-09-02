import notifee, { AndroidCategory, AndroidImportance } from '@notifee/react-native';
import { Platform } from 'react-native';
import { OFFER_CHANNEL_ID } from './channel';

/**
 * Turning an FCM data message into the thing that actually rings.
 *
 * This is the half that runs when the app is CLOSED. The server sends a data-only message; FCM
 * wakes the process just long enough for the background handler to call this, and this asks
 * Android for a full-screen intent — the same mechanism an incoming phone call uses, which is
 * why it can light the screen and appear over the lock screen.
 */

/** What the server puts in an `offer.new` data payload. All FCM data values arrive as strings. */
export interface OfferPushData {
  type: string;
  offerId?: string;
  bookingId?: string;
  reference?: string;
  expiresAt?: string;
  earningPaise?: string;
  pickupAddress?: string;
  serviceType?: string;
}

/** One id per offer, so a second wave cannot stack a second ring on top of the first. */
function notificationId(offerId: string): string {
  return `offer-${offerId}`;
}

/** `70875` → `₹708.75`. Money crosses the wire in paise and is never floated (docs/README.md). */
function rupees(paise: string | undefined): string {
  const value = Number(paise);
  if (!Number.isFinite(value)) return '';
  return `₹${(value / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

/**
 * Ring the phone for an offer.
 *
 * `fullScreenAction` is the ask that matters: with `USE_FULL_SCREEN_INTENT` granted Android
 * launches the app straight into the offer screen, screen on, over the lock screen. Where the
 * permission is refused — Android 14+ can withhold it — the same notification degrades to a
 * heads-up banner with the same looping alarm tone, which is loud but not automatic. Both are
 * handled by this one call; nothing branches.
 */
export async function displayOfferNotification(data: OfferPushData): Promise<void> {
  if (Platform.OS !== 'android') return;
  const offerId = data.offerId;
  if (offerId === undefined) return;

  const expiresAt = data.expiresAt === undefined ? null : new Date(data.expiresAt);
  const msLeft = expiresAt === null ? 0 : expiresAt.getTime() - Date.now();

  // An offer that has already lapsed must not ring. The driver would answer a trip somebody else
  // already has, which is the experience that teaches drivers to ignore the ring.
  if (msLeft <= 0) return;

  const earning = rupees(data.earningPaise);

  await notifee.displayNotification({
    id: notificationId(offerId),
    title: earning === '' ? 'New trip offer' : `New trip · ${earning}`,
    body: data.pickupAddress ?? 'Tap to see the trip',

    // Deep link into the ring screen, so tapping the notification lands on the same screen the
    // full-screen intent opens.
    data: { url: `/offer/${offerId}` },

    android: {
      channelId: OFFER_CHANNEL_ID,

      /*
       * `CALL` category plus `fullScreenAction` is what makes Android treat this as a ringing
       * call rather than a message: it wakes the screen and takes it over.
       */
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      fullScreenAction: { id: 'default', launchActivity: 'default' },
      pressAction: { id: 'default', launchActivity: 'default' },

      /*
       * Keep ringing until answered. A single chime is a notification; a driver needs something
       * that persists the way a call does. `ongoing` stops a swipe from dismissing it, and
       * `timeoutAfter` guarantees it clears itself when the offer lapses even if nothing else
       * removes it — the one safeguard against a notification that rings for ever.
       */
      loopSound: true,
      ongoing: true,
      autoCancel: false,
      timeoutAfter: msLeft,

      lightUpScreen: true,
    },
  });
}

/** Stop a ringing offer — the driver answered, or another driver won the race. */
export async function cancelOfferNotification(offerId: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.cancelNotification(notificationId(offerId));
}
