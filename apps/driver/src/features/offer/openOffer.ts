import { router } from 'expo-router';

/**
 * The ONE way to open the ring screen, and the guard that stops it opening twice.
 *
 * THE BUG THIS EXISTS FOR. Two independent things route to an offer, and for a single offer both
 * of them fire:
 *
 *   - `useOfferPushBridge` — the FCM message arrives while the app is in the foreground
 *   - `home.tsx` — its 4-second poll of `/driver/offers/current` returns the same offer
 *
 * Home stays mounted and keeps polling underneath the pushed screen, so the two are not
 * alternatives; they are both true, in either order. The result was two `/offer/<id>` screens
 * stacked on each other. The driver accepted on the top one — which succeeded, the booking really
 * was assigned to them — then that screen closed itself and revealed the SECOND copy, whose own
 * query had meanwhile resolved to `offer: null` because the offer was now claimed. So it rendered
 * "This trip is no longer available." over a trip the driver had just successfully won, and it
 * looked exactly like the accept had failed.
 *
 * Deduping on the href rather than counting screens keeps it honest whichever trigger wins the
 * race: the first caller routes, the second is a no-op.
 *
 * **The guard is never cleared, deliberately.** Clearing it on close would reopen the same hole
 * from the other side — decline quickly, the screen closes, and a poll that had not yet seen the
 * offer then routes to a dead one. Offer ids are single-use (`runWave` excludes drivers already
 * offered a booking), so a new offer always brings a new href and nothing legitimate is ever
 * blocked. This lives for the life of the process, which is one string.
 */
let routedHref: string | null = null;

/** Route to a ring screen once. `href` is `/offer/<offerId>`. */
export function openOffer(href: string): void {
  if (routedHref === href) return;
  routedHref = href;
  router.push(href);
}

/** `/offer/<id>` for an offer id, so callers never build the path by hand. */
export function offerHref(offerId: string): string {
  return `/offer/${offerId}`;
}
