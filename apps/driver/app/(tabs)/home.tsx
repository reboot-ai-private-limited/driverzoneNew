import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusPill } from '@/components/StatusPill';
import { Logo } from '@/components/Logo';
import { hasConfirmedBatterySetup } from '@/features/onboarding/batteryOptimisation';
import { isPinging, startLocationPings, stopLocationPings } from '@/duty/locationPings';
import { registerForPush, stopPushRegistration } from '@/notifications/registerDevice';
import { getProfile, setDuty } from '@/lib/api/endpoints/driver';
import { getCurrentOffer } from '@/lib/api/endpoints/offers';
import { keys } from '@/lib/query/keys';
import { colors, radius, shadow, space, text } from '@/theme/theme';

/**
 * The duty screen — where an approved driver spends every shift.
 *
 * **Duty is SERVER state.** `MongoDriverPool` filters on `isOnDuty` when a wave picks who to
 * ring, so a driver who is "on duty" only in their app's memory is offered nothing and has no
 * way to tell. The toggle is a mutation against `POST /driver/duty`; the rendered state comes
 * from the profile's own `is_on_duty`. That is also why it survives closing the app — there is
 * nothing local to lose.
 *
 * Still to come with the offer system (docs/LLD/driver-app.md S-8/S-9): the Android foreground
 * service, FCM token registration, and the location pings that keep a driver eligible. Going on
 * duty will start all three; the marks are below.
 */
export default function HomeScreen(): ReactElement {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });

  const onDuty = profile.data?.is_on_duty ?? false;
  const [dutyError, setDutyError] = useState<string | null>(null);

  const duty = useMutation({
    mutationFn: (next: boolean) => setDuty(next ? 'ONLINE' : 'OFFLINE'),
    onMutate: () => setDutyError(null),
    onSuccess: async (state) => {
      // Refetch rather than write the flag in by hand: the server decides, and a hand-patched
      // cache that disagrees with it is exactly the drift this screen is meant not to have.
      await queryClient.invalidateQueries({ queryKey: keys.profile.all() });

      /**
       * Duty and the location loop start and stop together, because duty alone does not make a
       * driver dispatchable: `MongoDriverPool` also requires a `lastLocationAt` inside a
       * two-minute window. On duty with no pings is invisible to every wave.
       */
      if (state.is_on_duty) {
        const started = await startLocationPings();
        if (!started) {
          setDutyError(
            'Location permission is needed to receive trips. Turn it on in Settings, then go on duty again.',
          );
        }
        /**
         * Register for push in the same breath.
         *
         * This is what makes an offer ring with the app CLOSED — the polling below only runs
         * while this screen is alive. A driver who declines notification permission can still
         * work, but only with the app open, so it is worth saying so rather than leaving them to
         * wonder why trips stopped.
         */
        const pushable = await registerForPush();
        if (!pushable) {
          setDutyError(
            'Notifications are off, so trips will only alert you while the app is open. Turn them on in Settings.',
          );
        }
      } else {
        stopLocationPings();
        stopPushRegistration();
      }
    },
    onError: (cause) => {
      // The server's wording, verbatim — a 409 here means not approved, and later documents
      // expired or wallet blocked. Never build that copy from `code`.
      setDutyError(
        cause instanceof Error ? cause.message : 'Could not change your duty status.',
      );
    },
  });

  const firstName = profile.data?.full_name?.trim().split(' ')[0] ?? 'there';

  /**
   * Polling for a ringing offer.
   *
   * A stand-in for the push that lands with S-9: polling only works while this screen is alive,
   * so it cannot ring a closed app — but it proves the whole chain (book → wave → offer →
   * accept) with no Firebase, and the ring screen it opens is the same one FCM will open later.
   *
   * Only while ON DUTY. An off-duty driver has no offers by definition, and polling anyway would
   * burn battery to always be told no.
   */
  const offer = useQuery({
    queryKey: keys.offers.current(),
    queryFn: ({ signal }) => getCurrentOffer(signal),
    enabled: onDuty,
    refetchInterval: onDuty ? 4000 : false,
    // Never serve a cached answer: an offer that arrived a second ago is the whole point.
    staleTime: 0,
  });

  /**
   * Open the ring screen the moment one appears.
   *
   * `router.push`, so declining or losing the race returns here rather than unwinding to a blank
   * stack. The offer id is in the path, but the screen re-reads the offer itself — see its
   * header for why.
   */
  const ringingOfferId = offer.data?.offer?.offer_id ?? null;
  useEffect(() => {
    if (ringingOfferId !== null) router.push(`/offer/${ringingOfferId}`);
  }, [ringingOfferId]);

  /**
   * Resume the on-duty machinery on a cold start.
   *
   * Duty survives closing the app, but nothing that DELIVERS work to the driver does — both the
   * location loop and the push registration live in this process. A driver who was on duty
   * yesterday reopens the app already "online" and would otherwise sit there invisible to
   * dispatch until they toggled off and on again.
   *
   * Re-registering for push is the half that is easy to forget and impossible to notice: without
   * it a driver on a fresh install is on duty with no FCM token, dispatch logs "driver has no
   * registered device", and every offer lapses in silence while the app looks perfectly healthy.
   * Both calls are idempotent — `isPinging()` guards one and the server's `$addToSet` guards the
   * other — so this is safe on every render pass.
   */
  useEffect(() => {
    if (!onDuty) return;
    if (!isPinging()) void startLocationPings();
    void registerForPush();
  }, [onDuty]);

  /**
   * The battery-optimisation nudge (S-12). Shows until the driver confirms they have lifted the
   * restriction, and re-checks every time Home regains focus — so it clears the instant they
   * come back from the setup screen having pressed "I've set this up".
   *
   * `undefined` while the first read is in flight, so the banner does not flash in and out on a
   * cold start.
   */
  const [batteryConfirmed, setBatteryConfirmed] = useState<boolean | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void hasConfirmedBatterySetup().then((value) => {
        if (active) setBatteryConfirmed(value);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Logo width={140} />
        <StatusPill
          label={onDuty ? 'Online' : 'Offline'}
          tone={onDuty ? 'success' : 'neutral'}
          icon={onDuty ? 'wifi' : 'wifi-off'}
        />
      </View>

      <View style={styles.body}>
        <Text style={styles.greeting}>Hello, {firstName}</Text>
        <Text style={styles.greetingSub}>
          {onDuty ? 'You are online. Trip offers will ring on this phone.' : 'Go online to start receiving trips.'}
        </Text>

        {batteryConfirmed === false ? (
          <Pressable
            onPress={() => router.push('/battery-setup')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.batteryBanner, pressed && styles.batteryBannerPressed]}
          >
            <View style={styles.batteryIcon}>
              <Feather name="alert-triangle" size={16} color={colors.warning} />
            </View>
            <View style={styles.batteryText}>
              <Text style={styles.batteryTitle}>Finish alert setup</Text>
              <Text style={styles.batteryBody}>
                Your phone may still silence trip offers in the background.
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.faint} />
          </Pressable>
        ) : null}

        {/* The duty card. One control, deliberately the largest thing on the screen — it is the
            only decision a driver makes between trips. */}
        <View style={[styles.dutyCard, onDuty ? styles.dutyCardOn : styles.dutyCardOff]}>
          <View style={styles.dutyIcon}>
            <Feather
              name={onDuty ? 'radio' : 'power'}
              size={30}
              color={onDuty ? colors.dutyOn : colors.dutyOff}
            />
          </View>

          <Text style={styles.dutyTitle}>{onDuty ? "You're on duty" : "You're off duty"}</Text>
          <Text style={styles.dutyBody}>
            {onDuty
              ? 'Keep the app installed and battery optimisation off so offers reach you.'
              : 'Dispatch only offers trips to drivers who are on duty.'}
          </Text>

          <Pressable
            onPress={() => duty.mutate(!onDuty)}
            disabled={duty.isPending || profile.isPending}
            accessibilityRole="switch"
            accessibilityState={{ checked: onDuty, busy: duty.isPending }}
            style={({ pressed }) => [
              styles.dutyButton,
              onDuty ? styles.dutyButtonOn : styles.dutyButtonOff,
              pressed && styles.dutyButtonPressed,
              duty.isPending && styles.dutyButtonBusy,
            ]}
          >
            {duty.isPending ? (
              <ActivityIndicator color={onDuty ? colors.dutyOn : colors.brandOnFg} />
            ) : (
              <Text style={[styles.dutyButtonText, onDuty && styles.dutyButtonTextOn]}>
                {onDuty ? 'Go off duty' : 'Go on duty'}
              </Text>
            )}
          </Pressable>

          {dutyError !== null ? (
            <Text style={styles.dutyError} accessibilityLiveRegion="polite">
              {dutyError}
            </Text>
          ) : null}
        </View>

        {/*
          An honest placeholder, not a fake dashboard. Inventing "0 trips · ₹0" would look like
          real data on a driver's first morning and quietly train them to distrust the numbers.
        */}
        <View style={styles.notice}>
          <Feather name="info" size={16} color={colors.muted} />
          <Text style={styles.noticeText}>
            Trip offers, navigation and earnings arrive in the next release. Your account is set up
            and ready.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.bg },

  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  body: { padding: space.lg },

  greeting: { ...text.title, color: colors.fg },
  greetingSub: { ...text.body, color: colors.muted, marginTop: space.xs, marginBottom: space.lg },

  batteryBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: '#FFF6E0',
    borderWidth: 1,
    borderColor: '#F0D9A0',
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.xl,
  },
  batteryBannerPressed: { opacity: 0.9 },
  batteryIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  batteryText: { flex: 1 },
  batteryTitle: { ...text.label, color: colors.fg },
  batteryBody: { ...text.caption, color: colors.muted, marginTop: 2 },

  dutyCard: {
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    borderWidth: 1,
    ...shadow.card,
  },
  dutyCardOn: { backgroundColor: colors.dutyOnBg, borderColor: colors.dutyOn },
  dutyCardOff: { backgroundColor: colors.card, borderColor: colors.border },
  dutyIcon: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  dutyTitle: { ...text.heading, color: colors.fg },
  dutyBody: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.xs },

  dutyButton: {
    marginTop: space.lg,
    height: 54,
    minWidth: 220,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  dutyButtonOff: { backgroundColor: colors.fg },
  dutyButtonOn: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.dutyOn },
  dutyButtonPressed: { opacity: 0.85 },
  dutyButtonBusy: { opacity: 0.7 },
  dutyButtonText: { ...text.heading, color: colors.brandOnFg },
  dutyButtonTextOn: { color: colors.dutyOn },
  dutyError: { ...text.caption, color: colors.danger, textAlign: 'center', marginTop: space.md },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.xl,
  },
  noticeText: { ...text.caption, color: colors.muted, flex: 1 },
});
