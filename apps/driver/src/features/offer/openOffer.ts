import { router } from 'expo-router';

/**
 * The ONE way to open the ring screen, and the guards that stop it opening twice.
 *
 * THE ORIGINAL BUG THIS EXISTS FOR. Two independent things route to an offer, and for a single
 * offer both of them fire:
 *
 *   - `useOfferPushBridge` — the FCM message arrives while the app is in the foreground
 *   - `home.tsx` — its 4-second poll of `/driver/offers` returns the same offer
 *
 * Home stays mounted and keeps polling underneath the pushed screen, so the two are not
 * alternatives; they are both true, in either order. The result was two `/offer/<id>` screens
 * stacked on each other. The driver accepted on the top one — which succeeded, the booking really
 * was assigned to them — then that screen closed itself and revealed the SECOND copy, whose own
 * query had meanwhile resolved to `offer: null` because the offer was now claimed. So it rendered
 * "This trip is no longer available." over a trip the driver had just successfully won, and it
 * looked exactly like the accept had failed.
 *
 * **A second, different bug (2026-09-04): a driver can legitimately hold more than one live
 * offer.** Two customers booking near-simultaneously can both dispatch to the same driver. The
 * per-href latch below does nothing for that case — a different offer has a different href and
 * sailed straight through, stacking a second ring screen on top of the first exactly the way the
 * original bug did. `ringScreenOpen` is the fix: while ANY ring screen is mounted, a new offer —
 * same or different — does not get its own screen. The mounted screen's own list poll picks it up
 * and offers it as "+N more waiting" instead. See `apps/driver/app/offer/[offerId].tsx`.
 */
let routedHref: string | null = null;

/**
 * True while a `[offerId].tsx` screen is mounted, however it got there.
 *
 * NOT ONLY SET FROM `openOffer()`. Switching to another queued offer from inside the ring screen
 * (the "+N more" sheet, or auto-advancing once the current one resolves) uses `router.replace`
 * directly rather than this function — that is the screen's own intentional navigation, not an
 * external trigger to be deduped. `router.replace` on this route fully unmounts the old screen and
 * mounts a new one (no `getId`/preloading is configured for it), so without the destination screen
 * re-asserting `markOfferScreenOpen()` on its own mount, this flag would be left `false` forever
 * after the first such internal switch — reopening the exact stacking bug this file exists to
 * prevent, the next time a third offer arrived.
 */
let ringScreenOpen = false;

/** Route to a ring screen, unless one is already open. `href` is `/offer/<offerId>`. */
export function openOffer(href: string): void {
  if (ringScreenOpen) return;
  if (routedHref === href) return;
  routedHref = href;
  ringScreenOpen = true;
  router.push(href);
}

/**
 * Call from the ring screen's own mount effect, unconditionally — including when it was reached
 * by the screen replacing itself with another offer rather than through `openOffer`.
 */
export function markOfferScreenOpen(): void {
  ringScreenOpen = true;
}

/**
 * Call from the ring screen's unmount cleanup.
 *
 * Only releases `ringScreenOpen` — never `routedHref`, which is a PERMANENT per-href latch and
 * deliberately never cleared: offer ids are single-use (`runWave` excludes drivers already
 * offered a booking), so a stale poll response for an offer that was just resolved must never be
 * allowed to reopen it, however long after this screen has closed that poll returns.
 */
export function markOfferScreenClosed(): void {
  ringScreenOpen = false;
}

/** `/offer/<id>` for an offer id, so callers never build the path by hand. */
export function offerHref(offerId: string): string {
  return `/offer/${offerId}`;
}
