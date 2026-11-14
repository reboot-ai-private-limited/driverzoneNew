import { EventType, type Event } from '@notifee/react-native';
import { dispatchOfferAction } from '@/features/offer/offerActionBus';
import { openOffer } from '@/features/offer/openOffer';
import { declineOffer } from '@/lib/api/endpoints/offers';
import { getAccessToken, renew } from '@/lib/auth/session';
import { pushLog } from './log';
import { cancelOfferNotification } from './offerNotification';

/** Ids of the buttons on the ringing offer notification. */
export const OFFER_ACTION_ACCEPT = 'accept';
export const OFFER_ACTION_DECLINE = 'decline';

/** The ring screen reads this query flag and claims the trip the moment it mounts. */
export function autoAcceptHref(url: string): string {
  return `${url}?autoAccept=1`;
}

/**
 * One handler for every press on the ringing offer — the body, the Accept button, the Decline
 * button — shared by Notifee's foreground and background event hooks so the two cannot drift.
 *
 *   - body   → open the ring screen, nothing decided.
 *   - Accept → ACCEPTS. The button opens the app (`launchActivity`), and the ring screen claims the
 *     trip immediately — via the open screen if there is one, otherwise by opening it with
 *     `?autoAccept=1`. The screen still owns the outcome: "Trip X is yours" → trip screen, or
 *     "another driver got it first" when the race is lost.
 *   - Decline → declined without opening the app. If the ring screen is open, through it, so it
 *     closes at once; otherwise straight to the API (works headless — a killed process has no
 *     access token until it renews one).
 */
export async function handleOfferNotificationEvent({ type, detail }: Event): Promise<void> {
  const notification = detail.notification;
  const url = notification?.data?.['url'];
  const offerId = typeof notification?.data?.['offerId'] === 'string' ? notification.data['offerId'] : undefined;

  if (type === EventType.ACTION_PRESS) {
    const actionId = detail.pressAction?.id;
    pushLog('offer notification action', { actionId, url: typeof url === 'string' ? url : '(none)' });

    if (actionId === OFFER_ACTION_DECLINE) {
      if (offerId === undefined) return;
      await cancelOfferNotification(offerId).catch(() => undefined);
      if (dispatchOfferAction(offerId, 'decline')) return;
      try {
        if (getAccessToken() === null) await renew();
        await declineOffer(offerId);
        pushLog('offer declined from notification', { offerId });
      } catch (cause) {
        // Not fatal: the offer simply lapses on its own clock.
        pushLog('offer decline from notification FAILED', { offerId, error: String(cause) });
      }
      return;
    }

    if (actionId === OFFER_ACTION_ACCEPT && offerId !== undefined && typeof url === 'string') {
      await cancelOfferNotification(offerId).catch(() => undefined);
      if (dispatchOfferAction(offerId, 'accept')) return;
      openOffer(autoAcceptHref(url), { fromTap: true });
    }
    return;
  }

  if (type === EventType.PRESS && typeof url === 'string') {
    pushLog('offer notification PRESS', { url });
    openOffer(url, { fromTap: true });
  }
}
