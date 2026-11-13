import notifee, { AndroidImportance } from '@notifee/react-native';
import { BOOKING_CHANNEL_ID } from './channel';
import { pushLog } from './log';

/**
 * The FCM data payload the server sends for a ride update.
 *
 * `apps/api/.../fcm.pushSender.ts#sendBookingUpdate` — every value arrives as a string, and
 * `message` is already customer-safe copy (built server-side from the booking status). The client
 * shows it verbatim and never derives its own wording from `status` — a phrasing added
 * server-side has to render on an app build that predates it.
 */
export interface BookingUpdateData {
  type: string;
  bookingId?: string;
  reference?: string;
  status?: string;
  message?: string;
}

/** One id per booking, so a later update REPLACES the earlier one rather than stacking. */
function notificationId(bookingId: string): string {
  return `booking-${bookingId}`;
}

/** Where a tap should land — the live trip screen for this booking. */
export function bookingHref(bookingId: string): string {
  return `/trip/${bookingId}`;
}

/**
 * Show a ride-update notification.
 *
 * Deliberately plain: `DEFAULT` importance, no `ongoing`, no `loopSound`, no full-screen intent.
 * Taps deep-link into the trip, and a newer update for the same booking overwrites the older one.
 *
 * Called on the FOREGROUND path only (`onMessage`) — the system draws the server's `notification`
 * block itself when the app is backgrounded, so drawing it here too would double up. Works on
 * both platforms: the `android` block is ignored on iOS, where Notifee shows a default banner.
 */
export async function displayBookingUpdate(data: BookingUpdateData): Promise<void> {
  const bookingId = data.bookingId;
  const body = data.message;
  if (bookingId === undefined || body === undefined || body === '') {
    pushLog('booking update skipped: missing bookingId/message', {
      data: data as unknown as Record<string, unknown>,
    });
    return;
  }

  const title = data.reference === undefined ? 'Ride update' : `Ride ${data.reference}`;

  try {
    await notifee.displayNotification({
      id: notificationId(bookingId),
      title,
      body,
      data: { url: bookingHref(bookingId) },
      android: {
        channelId: BOOKING_CHANNEL_ID,
        importance: AndroidImportance.DEFAULT,
        // Brand yellow. Android paints the whole background only for colorized-eligible
        // notifications (foreground service / call style); everywhere else it tints the icon,
        // app name and buttons. iOS ignores both — it has no notification colour at all.
        color: '#F2F200',
        colorized: true,
        pressAction: { id: 'default', launchActivity: 'default' },
        // Cleared when the customer taps it — unlike the driver's offer ring, there is nothing
        // time-critical to keep on screen.
        autoCancel: true,
        timestamp: Date.now(),
        showTimestamp: true,
      },
    });
    pushLog('booking update shown', { bookingId, status: data.status });
  } catch (cause) {
    pushLog('booking update FAILED to display', { bookingId, error: String(cause) });
  }
}
