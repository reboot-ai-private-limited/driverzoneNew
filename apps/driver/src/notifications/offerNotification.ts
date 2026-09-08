import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  type NotificationAndroid,
} from '@notifee/react-native';
import { Platform } from 'react-native';
import { OFFER_CHANNEL_ID } from './channel';
import { pushLog } from './log';

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
  dropAddress?: string;
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
 * A THREE-RUNG LADDER, and the middle rung is the fix. The old code had two: a rich notification
 * with `fullScreenAction`, and — if that threw — a plain silent one. On Android 14+ the rich
 * `displayNotification` THROWS when `USE_FULL_SCREEN_INTENT` is not granted (Notifee validates it
 * natively and rejects, rather than degrading), and this device is exactly that case:
 * `USE_FULL_SCREEN_INTENT: deny` on a realme running Android 15. So every offer fell through to
 * the plain rung — a notification with no sound loop, no `ongoing`, no CALL category. It showed.
 * It did not ring. That is the bug the driver reported.
 *
 * The rungs now, best first:
 *
 *   1. WITH `fullScreenAction` — wakes the screen and opens the ring screen over the lock, like
 *      a call. Only works where the permission is held.
 *   2. WITHOUT `fullScreenAction`, everything else kept — `loopSound`, `ongoing`, `CALL`
 *      category, HIGH importance, `lightUpScreen`. This is a LOUD, PERSISTENT, LOOPING heads-up
 *      that just does not auto-launch. It is what the header of the old code PROMISED and the old
 *      code did not deliver, because rung 1's throw skipped straight past it.
 *   3. A plain one-shot notification. Last resort, for a device that rejects `ongoing`/`loopSound`
 *      from a headless task outright.
 *
 * Every attempt is logged (`[dz-push]`), so a field report says which rung fired rather than just
 * "it did not ring".
 */
export async function displayOfferNotification(data: OfferPushData): Promise<void> {
  if (Platform.OS !== 'android') return;
  const offerId = data.offerId;
  if (offerId === undefined) {
    pushLog('offer.display skipped: no offerId', { data: data as unknown as Record<string, unknown> });
    return;
  }

  const expiresAt = data.expiresAt === undefined ? null : new Date(data.expiresAt);
  const msLeft = expiresAt === null ? 0 : expiresAt.getTime() - Date.now();

  // An offer that has already lapsed must not ring. The driver would answer a trip somebody else
  // already has, which is the experience that teaches drivers to ignore the ring.
  if (msLeft <= 0) {
    pushLog('offer.display skipped: already expired', { offerId, expiresAt: data.expiresAt });
    return;
  }

  const earning = rupees(data.earningPaise);

  // Pickup → drop when both are known, so the driver reads the trip's shape off the ring itself
  // rather than only after it opens.
  const route =
    data.pickupAddress !== undefined && data.dropAddress !== undefined
      ? `${data.pickupAddress} → ${data.dropAddress}`
      : (data.pickupAddress ?? 'Tap to see the trip');

  const id = notificationId(offerId);
  const title = earning === '' ? 'New trip offer' : `New trip · ${earning}`;
  // Deep link into the ring screen, so tapping the notification lands on the same screen the
  // full-screen intent opens.
  const payload = { url: `/offer/${offerId}` };

  /**
   * Everything that makes the notification LOUD and PERSISTENT — shared by rungs 1 and 2.
   *
   * NO `loopSound`. It was the reason the notification vibrated but stayed silent on the test
   * handset (realme, Android 15). `loopSound` makes Notifee play the tone ITSELF through an
   * ExoPlayer instance, and from a headless FCM wake that player has no audio focus and produces
   * nothing — while the vibration, which the system owns, still fires. Dropping it hands the tone
   * back to the system, which plays a channel sound headlessly without needing anything from the
   * app. `sound` is also named explicitly here, not just on the channel, because some OEM builds
   * only take the system-playback path when the notification itself carries it.
   *
   * The trade: `offer_ring.mp3` is a ~5-second alarm tone that now plays ONCE rather than looping
   * to the offer's expiry. `ongoing` still holds the notification on screen, the vibration
   * pattern still repeats, and `lightUpScreen` still wakes the display — so it still reads as a
   * ring, just not an endless one. A looping tone can come back later, gated on a device check
   * that confirms ExoPlayer actually produced sound.
   */
  const ringingBase: NotificationAndroid = {
    channelId: OFFER_CHANNEL_ID,
    // `CALL` is what asks Android to treat this as a call rather than a message — heads-up,
    // ringtone stream, harder to bury. It does not need any permission.
    category: AndroidCategory.CALL,
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    pressAction: { id: 'default', launchActivity: 'default' },
    // Named on the notification as well as the channel — see the note above.
    sound: 'offer_ring',
    // A long, repeating buzz so the phone is felt as well as heard.
    vibrationPattern: [300, 500, 300, 500, 300, 500],
    ongoing: true,
    autoCancel: false,
    timeoutAfter: msLeft,
    lightUpScreen: true,
  };

  // ── Rung 1: with the full-screen intent ────────────────────────────────────────────────────
  try {
    await notifee.displayNotification({
      id,
      title,
      body: route,
      data: payload,
      android: {
        ...ringingBase,
        // With `USE_FULL_SCREEN_INTENT` held, Android launches the app straight onto the ring
        // screen, screen on, over the lock. Without it, Notifee 9.x on API 34+ REJECTS this call
        // rather than dropping the flag — hence the ladder.
        fullScreenAction: { id: 'default', launchActivity: 'default' },
      },
    });
    pushLog('offer.display ok: rung 1 (full-screen)', { offerId, msLeft });
    return;
  } catch (cause) {
    pushLog('offer.display rung 1 failed', { offerId, error: String(cause) });
  }

  // ── Rung 2: no full-screen intent, still a loud looping heads-up ───────────────────────────
  try {
    await notifee.displayNotification({
      id,
      title,
      body: route,
      data: payload,
      android: ringingBase,
    });
    pushLog('offer.display ok: rung 2 (looping heads-up, no full-screen)', { offerId, msLeft });
    return;
  } catch (cause) {
    pushLog('offer.display rung 2 failed', { offerId, error: String(cause) });
  }

  // ── Rung 3: a plain one-shot notification ─────────────────────────────────────────────────
  try {
    await notifee.displayNotification({
      id,
      title,
      body: route,
      data: payload,
      android: {
        channelId: OFFER_CHANNEL_ID,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'default', launchActivity: 'default' },
        timeoutAfter: msLeft,
      },
    });
    pushLog('offer.display ok: rung 3 (plain)', { offerId, msLeft });
  } catch (cause) {
    // Notifications are blocked outright at the OS level. Nothing further is possible from here.
    pushLog('offer.display FAILED: all rungs', { offerId, error: String(cause) });
  }
}

/** Stop a ringing offer — the driver answered, or another driver won the race. */
export async function cancelOfferNotification(offerId: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifee.cancelNotification(notificationId(offerId));
}

/**
 * The offer that launched this process, if the app was cold and the driver tapped one.
 *
 * READ FROM EXACTLY ONE PLACE: the boot screen, before it makes its own routing decision. This
 * used to be read from the root layout's push bridge instead, in a `useEffect` that ran on the
 * very first render — before `<Stack>` exists, while the boot screen's own effect is already
 * running concurrently toward its unconditional `router.replace('/gate')`. Both calls go through
 * expo-router's `routingQueue`, which is safe to push onto before a navigator has mounted — so
 * the ring screen genuinely did get queued — but a REPLACE queued a few hundred milliseconds
 * later swaps out whatever is on top regardless of how it got there. The offer was pushed, then
 * immediately overwritten, and the ring the driver tapped never stayed on screen. Moving the read
 * into the boot screen's own sequence — checked before its one `replace` — removes the race by
 * removing the second, uncoordinated caller.
 */
export async function getInitialOfferHref(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const initial = await notifee.getInitialNotification();
  const url = initial?.notification.data?.['url'];
  return typeof url === 'string' ? url : null;
}
