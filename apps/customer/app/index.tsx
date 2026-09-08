import Constants from 'expo-constants';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Logo } from '@/components/Logo';
import { getInitialNotificationHref } from '@/notifications/useNotificationBridge';
import * as session from '@/lib/auth/session';
import { colors, space, text } from '@/theme/theme';

/**
 * The boot screen. Restores the session, then routes.
 *
 * It exists because restoring a session ALWAYS costs a round-trip: the access token is never
 * persisted, so the app cannot know whether it is signed in until `/customer/auth/refresh`
 * answers (docs/LLD/auth.md). Something has to be on screen for that second.
 *
 * `session.restore()` swallows its own failures and resolves to `anonymous` — an offline launch
 * lands on the login screen, which is where the network error belongs, rather than stranding the
 * customer here.
 */

/** A floor, not a delay: below this the logo flashes rather than appears. */
const MINIMUM_VISIBLE_MS = 900;

/**
 * A boot screen that can hang forever is worse than one that gives up: the customer sees a
 * spinner and force-quits. If refresh has not answered by now, treat the launch as signed out.
 */
const RESTORE_TIMEOUT_MS = 8000;

export default function BootScreen(): ReactElement {
  // A ref, not state: this must survive re-renders without re-running the effect that reads it.
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      // Started alongside the restore, not awaited until the routing decision — checking for a
      // tapped notification adds nothing to the time already spent restoring the session.
      const initialHref = getInitialNotificationHref();

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

      // A cold start from a tapped ride-update notification goes straight to that trip. Checked
      // here, immediately before the ONE `replace` this screen issues, so nothing downstream can
      // race and overwrite it. `replace`, never `push`: the hardware back button must exit or go
      // home, not reveal this screen.
      const href = await initialHref;
      router.replace((href ?? '/home') as never);
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Logo width={260} />

        <ActivityIndicator size="large" color={colors.fg} style={styles.spinner} />
        <Text style={styles.heading}>Initializing…</Text>
        <Text style={styles.sub}>Please wait while we set things up for you</Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Version {Constants.expoConfig?.version ?? '0.1.0'}</Text>
        <Text style={styles.footerText}>© 2026 Driver Zone. All rights reserved.</Text>
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
