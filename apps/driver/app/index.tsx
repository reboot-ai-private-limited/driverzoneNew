import Constants from 'expo-constants';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Logo } from '@/components/Logo';
import * as session from '@/lib/auth/session';
import { getInitialOfferHref } from '@/notifications/offerNotification';
import { colors, space, text } from '@/theme/theme';

/**
 * The boot screen. Restores the session, checks for a tapped offer, then routes.
 *
 * It exists because restoring a session ALWAYS costs a round-trip: the access token is never
 * persisted, so the app cannot know whether it is signed in until `/driver/auth/refresh` answers
 * (docs/LLD/auth.md). Something has to be on screen for that second.
 *
 * `session.restore()` swallows its own failures and resolves to `anonymous` — an offline launch
 * lands on the login screen, which is where the network error belongs, rather than stranding the
 * driver here.
 *
 * NORMALLY it routes only as far as `/gate`, which is the screen that knows about onboarding
 * status — this screen deliberately does not, since fetching a profile here would put a second
 * round-trip in front of the first frame. THE ONE EXCEPTION is a cold start from a tapped offer
 * notification: that goes straight to the ring screen, checked and decided right here rather than
 * in a separate effect elsewhere, which is what used to race this function's own `replace` and
 * lose. See `getInitialOfferHref` for why the read has to happen in this one place.
 */

/** A floor, not a delay: below this the wordmark flashes rather than appears. */
const MINIMUM_VISIBLE_MS = 900;

/**
 * A boot screen that can hang forever is worse than one that gives up: the driver sees a spinner
 * and force-quits — which on Android is the one state nothing can wake the app from
 * (docs/LLD/driver-app.md S-1). If refresh has not answered by now, treat the launch as signed out.
 */
const RESTORE_TIMEOUT_MS = 8000;

export default function BootScreen(): ReactElement {
  // A ref, not state: this must survive re-renders without re-running the effect that reads it.
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      /*
       * Started immediately, alongside the session restore — not awaited until the routing
       * decision at the bottom, so checking for a tapped offer adds nothing on top of the delay
       * already spent restoring the session and holding the wordmark up for its minimum.
       */
      const initialOffer = getInitialOfferHref();

      await Promise.race([
        session.restore(),
        new Promise((resolve) => setTimeout(resolve, RESTORE_TIMEOUT_MS)),
      ]);

      const elapsed = Date.now() - startedAt.current;
      if (elapsed < MINIMUM_VISIBLE_MS) {
        await new Promise((resolve) => setTimeout(resolve, MINIMUM_VISIBLE_MS - elapsed));
      }

      // The screen can unmount mid-await on a Fast Refresh; routing after that warns and does
      // nothing useful.
      if (cancelled) return;

      if (session.getState().status !== 'authenticated') {
        router.replace('/phone');
        return;
      }

      /*
       * THE OFFER WINS, by construction rather than by luck. This used to be checked in the root
       * layout's push bridge instead, in an effect that runs on the very first render — before
       * this function's own `replace` below, and with no knowledge of each other. The bridge
       * would push the ring screen the moment the read resolved; a few hundred milliseconds
       * later this function's unconditional `replace('/gate')` swapped it straight back out, and
       * `gate.tsx`'s own trip-recovery redirect could then carry the driver somewhere else again.
       * A driver who tapped a ringing offer to open a killed app landed on Duty having never
       * seen what they tapped.
       *
       * Checked here, immediately before the ONE `replace` this function ever issues, there is
       * nothing left downstream that can race it: `/gate` is only reached when there was nothing
       * to recover.
       */
      const offerHref = await initialOffer;

      // `replace`, never `push`: the hardware back button must exit the app or return to Duty,
      // not reveal a boot screen that would immediately route forward again.
      router.replace(offerHref ?? '/gate');
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Logo width={210} showBadge />

        <ActivityIndicator size="large" color={colors.fg} style={styles.spinner} />
        <Text style={styles.heading}>Starting up…</Text>
        <Text style={styles.sub}>Getting your account ready</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Version {Constants.expoConfig?.version ?? '0.1.0'}</Text>
        <Text style={styles.footerText}>© 2026 DriverZone. All rights reserved.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand, paddingHorizontal: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  spinner: { marginTop: space.xl * 1.5 },
  heading: { ...text.heading, color: colors.fg, marginTop: space.lg },
  sub: { ...text.body, color: colors.fg, opacity: 0.75, marginTop: space.xs },

  footer: { alignItems: 'center' },
  footerText: { ...text.caption, color: colors.fg, opacity: 0.8 },
});
