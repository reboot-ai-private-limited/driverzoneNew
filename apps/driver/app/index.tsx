import Constants from 'expo-constants';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Logo } from '@/components/Logo';
import { restoreDutyMachinery } from '@/duty/dutyRecovery';
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

      /**
       * `anonymous` is the only status that means SIGNED OUT.
       *
       * `booting` here means the race above was won by the timeout, not by `restore()` — the
       * refresh is still in flight on a slow connection. That says nothing about whether the
       * driver has a session, so the stored refresh token is the thing to ask, and a driver who
       * has one carries on to `/gate` rather than being sent to re-enter a phone number they are
       * already signed in with. The gate's own error state handles it if the request never lands.
       */
      const status = session.getState().status;
      if (status === 'anonymous' || (status === 'booting' && !(await session.hasStoredSession()))) {
        router.replace('/phone');
        return;
      }
      if (cancelled) return;

      /**
       * PUT THE DRIVER BACK ON DUTY AT THE OS LEVEL, before deciding where to send them.
       *
       * Duty survives being killed — it is server state — but nothing that DELIVERS work does:
       * the ping loop, the FCM registration and the foreground service all died with the process.
       * This used to be `home.tsx`'s job, which covered the driver who reopens onto Home and
       * missed the one who does not: a recovered trip routes straight to `/trip/[id]` below, so
       * Home never mounts and a driver on a live job stayed invisible to dispatch for the rest of
       * it.
       *
       * Not awaited. It reads a stored flag and starts a service; the first frame must not wait on
       * either, and it reports its own failures through the duty screen when the driver gets
       * there.
       */
      void restoreDutyMachinery();

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
