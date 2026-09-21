import { router, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import * as session from './session';

/**
 * THE ONE THING THAT WAS MISSING WHEN A SESSION ENDED BY ITSELF.
 *
 * `endSession()` publishes `anonymous` and clears the keystore, and until this hook existed
 * nothing anywhere reacted to it. Every route to `/phone` in the app hung off a button the driver
 * pressed — Account, the onboarding screen, the gate's error state — plus `app/index.tsx`, which
 * only runs at launch. So a refresh rejected mid-shift left the driver exactly where they were,
 * on Home or a live trip, with a cleared session underneath.
 *
 * What they saw was the API's own 401 wording rendered as an ordinary screen error — "Please sign
 * in to continue." (`AppError.unauthenticated`) — with no way to act on it, because the one screen
 * that reads `anonymous` is the boot screen. Force-quitting and relaunching was the only way to
 * reach the login screen, and nothing on screen said so.
 *
 * Subscribing to the session MODULE rather than `useSession()` is deliberate: this has to sit
 * above `SessionProvider` in the tree, next to the push bridge, for the same reason that one does
 * — a redirect that only works once some particular screen is mounted is not a redirect.
 */
export function useSessionRedirect(): void {
  const [status, setStatus] = useState<session.SessionStatus>(() => session.getState().status);
  /*
   * Read as plain strings. `useSegments()` is typed as a union of the app's known route tuples,
   * every one of which has at least one member — so TypeScript rejects the empty-list check below
   * as impossible even though the boot screen genuinely produces `[]` at runtime.
   */
  const segments = useSegments() as readonly string[];

  useEffect(() => session.subscribe((next) => setStatus(next.status)), []);

  useEffect(() => {
    // `booting` is not signed out — it is the launch round-trip still in flight, and treating it
    // as a logout would send every cold start to the login screen for a second.
    if (status !== 'anonymous') return;

    // Already where we would send them. Without this the replace re-fires on every render of the
    // login screen, which is a navigation loop rather than a redirect.
    if (segments[0] === '(auth)') return;

    /*
     * THE BOOT SCREEN OWNS THE LAUNCH DECISION, and this must not race it.
     *
     * An empty segment list means `app/index.tsx` is on screen and its boot sequence is running.
     * That function makes exactly one `replace`, and it already handles `anonymous` — along with
     * the tapped-offer exception that has to win over everything else. Firing a second,
     * uncoordinated `replace` into it is precisely the bug documented in `getInitialOfferHref`,
     * where two callers queued routes a few hundred milliseconds apart and the later one silently
     * swapped out the earlier. Launch is its job; everything after launch is this one's.
     */
    if (segments.length === 0) return;

    router.replace('/phone');
  }, [status, segments]);
}
