import { pushLog } from '@/notifications/log';
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
 *
 * **A SET, AND IT ONLY EVER REFUSES AN AUTOMATIC OPEN (2026-09-21).** It was a single
 * `routedHref` string, which remembered only the most recent offer — so with two live offers the
 * older one was no longer deduped at all, which is the very thing this exists for.
 *
 * More importantly it used to refuse EVERY caller, including a driver tapping the notification.
 * A driver who backs out of a ring screen for an offer that is still ringing — a reflex, the back
 * gesture is where their thumb already is — could then never get back to it: the poll was refused
 * by this latch, the notification tap was refused by this latch, and the offer simply ran out its
 * clock against their acceptance rate. `fromTap` is the distinction that was missing. A poll is
 * the app guessing; a tap is the driver asking, and the two should never have shared a rule.
 */
const autoRoutedHrefs = new Set<string>();

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

/**
 * Route to a ring screen, unless one is already open. `href` is `/offer/<offerId>`.
 *
 * `fromTap` marks the one caller that is a DELIBERATE REQUEST rather than a trigger: the driver
 * pressed the notification. It skips the per-href latch — see `autoRoutedHrefs` — but NOT
 * `ringScreenOpen`, because a tap for a second offer while the first is on screen is still the
 * stacking bug this file exists to prevent, and the mounted screen already surfaces the other
 * offer as "+N more waiting".
 *
 * EVERY PATH LOGS, because the early returns below are silent refusals of the app's most
 * important navigation, and from the outside a blocked route is indistinguishable from a push
 * that never arrived. `[dz-push]` already carries the other half of that story — which handler
 * took the message and which notification rung fired — and it ended exactly where the interesting
 * question began.
 */
export function openOffer(href: string, options?: { fromTap?: boolean }): void {
  const fromTap = options?.fromTap === true;

  if (ringScreenOpen) {
    pushLog('openOffer BLOCKED: a ring screen is already open', { href, fromTap });
    return;
  }
  if (autoRoutedHrefs.has(href) && !fromTap) {
    pushLog('openOffer BLOCKED: already auto-routed once this process', { href });
    return;
  }

  /*
   * Recorded even for a tap. Backing out again must not let the 4-second poll drag the driver
   * straight back into a screen they just left — the latch's original job, which is still worth
   * doing for everything that is not a deliberate press.
   */
  autoRoutedHrefs.add(href);
  ringScreenOpen = true;
  pushLog('openOffer: pushing ring screen', { href, fromTap });
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
 * Only releases `ringScreenOpen` — never `autoRoutedHrefs`, which stays for the life of the
 * process: offer ids are single-use (`runWave` excludes drivers already offered a booking), so a
 * stale poll response for an offer that was just resolved must never be allowed to reopen it,
 * however long after this screen has closed that poll returns. A driver who wants back into an
 * offer that is still ringing taps the notification, which passes `fromTap` and is not refused.
 */
export function markOfferScreenClosed(): void {
  ringScreenOpen = false;
}

/** `/offer/<id>` for an offer id, so callers never build the path by hand. */
export function offerHref(offerId: string): string {
  return `/offer/${offerId}`;
}
