import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Logo } from '@/components/Logo';
import { hasSeenBatterySetup } from '@/features/onboarding/batteryOptimisation';
import { getProfile } from '@/lib/api/endpoints/driver';
import * as session from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';
import { colors, space, text } from '@/theme/theme';

/**
 * THE ONBOARDING GATE — the screen that decides where a signed-in driver actually belongs.
 *
 * The customer app has nothing like this because a customer's profile completes progressively and
 * never blocks anything. A driver's does block: `onboardingStatus` must reach `APPROVED` before
 * `POST /driver/duty` will do anything at all (docs/LLD/user.md §Driver onboarding), so a driver
 * who is not approved must not land on Home and find the only control there refuses to work.
 *
 * It is a screen rather than a branch inside `app/index.tsx` for one reason: the decision needs
 * the PROFILE, and the boot screen has only a session. Putting a second network round-trip in
 * front of the first frame would make every cold start visibly slower for the approved drivers
 * who are the majority. This way the boot screen answers "signed in?" and this one answers
 * "signed in as what?", each with the one call it needs.
 */
export default function GateScreen(): ReactElement {
  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

  const status = profile.data?.onboarding_status;

  useEffect(() => {
    if (status === undefined) return;

    let cancelled = false;

    void (async () => {
      if (status !== 'APPROVED') {
        if (!cancelled) router.replace('/onboarding-status');
        return;
      }

      /**
       * A freshly-approved driver is sent through the battery-optimisation screen ONCE (S-12)
       * before they ever see Home. It is the highest-leverage screen in the app and a driver who
       * skips past it on Home may never come back to it — so it gets one guaranteed showing,
       * right when "so my offers reach me" is the thing they care about.
       *
       * `hasSeenBatterySetup` flips the moment that screen decides not to nag harder, so this
       * fires at most once per install. Everything after is the Home banner's job.
       */
      const seen = await hasSeenBatterySetup();
      if (!cancelled) router.replace(seen ? '/home' : '/battery-setup');
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  if (profile.isError) {
    return (
      <View style={styles.root}>
        <View style={styles.center}>
          <Logo width={170} />
          <Text style={styles.heading}>Could not load your account</Text>
          {/*
            The server's own wording, verbatim. Never copy built from `code` — a reason added
            server-side has to render correctly on a build that predates it, and this app's
            installed version is a Play Store binary nobody can recall.
          */}
          <Text style={styles.sub}>
            {profile.error instanceof Error
              ? profile.error.message
              : 'Something went wrong. Please try again.'}
          </Text>

          <Pressable
            onPress={() => void profile.refetch()}
            accessibilityRole="button"
            style={styles.retry}
          >
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>

          {/*
            A way out that is not "retry". If the account itself is the problem — a revoked
            session that still refreshes, a driver record deleted under them — retrying forever
            is a trap, and signing out is the only move that can help.
          */}
          <Pressable
            onPress={() => {
              void session.signOut().then(() => router.replace('/phone'));
            }}
            accessibilityRole="button"
            style={styles.signOut}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Logo width={210} showBadge />
        <ActivityIndicator size="large" color={colors.fg} style={styles.spinner} />
        <Text style={styles.heading}>Loading your account…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.brand, paddingHorizontal: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  spinner: { marginTop: space.xl * 1.5 },
  heading: { ...text.heading, color: colors.fg, marginTop: space.lg, textAlign: 'center' },
  sub: {
    ...text.body,
    color: colors.fg,
    opacity: 0.8,
    marginTop: space.xs,
    textAlign: 'center',
  },

  retry: {
    marginTop: space.lg,
    backgroundColor: colors.fg,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: 999,
  },
  retryText: { ...text.label, color: colors.brandOnFg },
  signOut: { marginTop: space.md, padding: space.sm },
  signOutText: { ...text.body, color: colors.fg, textDecorationLine: 'underline' },
});
