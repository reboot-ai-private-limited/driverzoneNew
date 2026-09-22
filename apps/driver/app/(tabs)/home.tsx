import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusPill } from '@/components/StatusPill';
import { Logo } from '@/components/Logo';
import { needsBackgroundLocationDisclosure } from '@/features/onboarding/backgroundLocationDisclosure';
import { needsBatterySetup } from '@/features/onboarding/batteryOptimisation';
import { offerHref, openOffer } from '@/features/offer/openOffer';
import { formatWhen } from '@/features/trips/scheduledWhen';
import {
  ensureDutyMachinery,
  rememberDutyState,
  teardownDutyMachinery,
} from '@/duty/dutyRecovery';
import { registerForPush, stopPushRegistration } from '@/notifications/registerDevice';
import { getProfile, setDuty } from '@/lib/api/endpoints/driver';
import { listOffers } from '@/lib/api/endpoints/offers';
import { getCurrentTrip, listTrips } from '@/lib/api/endpoints/trip';
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
 * **Going on duty starts three things** (docs/LLD/driver-app.md S-8): the location ping loop, the
 * Android foreground service, and FCM token registration. Pings before the service, because the
 * service is typed `location` and Android refuses to start it without a runtime location grant.
 * Going off duty reverses it.
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
       *
       * NOT awaited. TanStack Query keeps `duty.isPending` true until this whole callback
       * settles, so awaiting either call here would leave the toggle spinning for as long as
       * THEY take — and `registerForPush` reaches Firebase's `getToken()`, a network call with no
       * timeout of its own, so a flaky connection would spin the button forever. The duty change
       * itself already succeeded server-side by the time we get here; these are follow-on setup
       * that report their own failures through `setDutyError` whenever they finish.
       */
      /*
       * Remember it FIRST, and on disk. This is what lets a process killed mid-shift come back on
       * duty at the next launch without waiting for the profile to load — see `dutyRecovery.ts`.
       */
      void rememberDutyState(state.is_on_duty);

      if (state.is_on_duty) {
        /**
         * One shared implementation, in `dutyRecovery.ts`, rather than a copy here.
         *
         * It owns the ordering rule that used to be spelled out at this call site: the location
         * grant must exist before a `location`-typed foreground service may be started, or Android
         * throws `SecurityException` natively inside `onStartCommand` — uncatchable from JS — and
         * crash-loops the app on the first "Go on duty" of a fresh install. That rule now has one
         * home, and the resume path gets it for free instead of re-deriving it.
         *
         * Failures are reported, not fatal: duty already succeeded server-side by the time this
         * runs, and a driver working with the app open beats one bounced back off duty.
         */
        void ensureDutyMachinery().then((result) => {
          if (result === 'no-location') {
            setDutyError(
              'Location permission is needed to receive trips. Turn it on in Settings, then go on duty again.',
            );
          } else if (result === 'no-service') {
            setDutyError(
              'We could not keep DriverZone running in the background. Offers may only reach you while the app is open — check notification and location permissions in Settings.',
            );
          }
        });
        /**
         * Register for push in the same breath.
         *
         * `ensureDutyMachinery` also registers, and idempotently — but it does not report back,
         * and a refused notification permission is the one failure a driver has to be told about:
         * it is the difference between offers that ring a closed app and offers that only arrive
         * while they are looking at the screen.
         *
         * `force` because this is a deliberate "I just went on duty" moment — it must not be
         * skipped by the rate limit that keeps the background callers from looping.
         */
        void registerForPush(true).then((pushable) => {
          if (!pushable) {
            setDutyError(
              'Notifications are off, so trips will only alert you while the app is open. Turn them on in Settings.',
            );
          }
        });

        /**
         * THE PROMINENT DISCLOSURE, on the way into the first shift.
         *
         * Play requires it before Android's background-location prompt, and this is the only
         * place in the app with both a reason to ask and a screen to ask from — the other two
         * callers of `startDutyForegroundService` are the boot receiver and the resume listener,
         * which run with nothing mounted. So the flow is: the service's own request is gated on
         * the stored consent (see its background-permission comment), and this navigates to the
         * screen that can write it.
         *
         * LAST in the callback and not awaited, deliberately. Duty already succeeded server-side
         * and the machinery above is already starting; pushing a screen is the least urgent thing
         * here and must not delay any of it. `needsBackgroundLocationDisclosure` answers false
         * for everyone who has already decided, already granted, or cannot be asked — so the
         * ordinary shift start pushes nothing at all.
         */
        void needsBackgroundLocationDisclosure().then((needed) => {
          if (needed) router.push('/location-disclosure');
        });
      } else {
        // The reverse order of going on duty: stop what the service was protecting, then release
        // the service itself, so the process is never kept alive for a loop that has already gone.
        stopPushRegistration();
        void teardownDutyMachinery();
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
   * Polling for ringing offers.
   *
   * A stand-in for the push that lands with S-9: polling only works while this screen is alive,
   * so it cannot ring a closed app — but it proves the whole chain (book → wave → offer →
   * accept) with no Firebase, and the ring screen it opens is the same one FCM will open later.
   *
   * Only while ON DUTY. An off-duty driver has no offers by definition, and polling anyway would
   * burn battery to always be told no.
   *
   * PLURAL (2026-09-04): a driver can legitimately hold more than one live offer — see
   * `ListDriverOffersResponse`. This screen only ever routes to the SOONEST-EXPIRING one; the ring
   * screen itself is what shows "+N more waiting" for the rest, once it is open.
   */
  const offers = useQuery({
    queryKey: keys.offers.list(),
    queryFn: ({ signal }) => listOffers(signal),
    enabled: onDuty,
    refetchInterval: onDuty ? 4000 : false,
    // Never serve a cached answer: an offer that arrived a second ago is the whole point.
    staleTime: 0,
  });

  /**
   * Open the ring screen the moment one appears.
   *
   * Through `openOffer`, NOT `router.push` directly. This poll is not the only thing that routes
   * to an offer — the FCM bridge in the root layout does too, and for a foreground push both
   * fire for the same offer. Pushing twice stacked two ring screens, and the second one surfaced
   * after a successful accept reading "This trip is no longer available." `openOffer` also now
   * refuses to stack a SECOND ring screen for a genuinely different offer while one is already
   * open — see its header.
   *
   * Still a push underneath, so declining or losing the race returns here rather than unwinding
   * to a blank stack. The offer id is in the path, but the screen re-reads the offer itself —
   * see its header for why.
   */
  const ringingOfferId = offers.data?.offers[0]?.offer_id ?? null;
  useEffect(() => {
    if (ringingOfferId !== null) openOffer(offerHref(ringingOfferId));
  }, [ringingOfferId]);

  /**
   * Reconcile the local memory of duty with what the profile actually says, and re-arm if needed.
   *
   * The PROFILE is the authority — duty is server state, and a driver taken off duty by an admin
   * or from another device must not be left with a service running here. `rememberDutyState` is
   * what carries that answer to `dutyRecovery.ts`, whose own callers (the boot screen, the resume
   * listener) run where no profile query exists.
   *
   * The re-arm itself is a safety net rather than the main path: the boot screen already did it
   * before this screen mounted. It stays because it is the one place that has seen the server's
   * current answer, so it corrects a stored flag that has drifted. `ensureDutyMachinery` now
   * coalesces concurrent callers and `startDutyForegroundService` no-ops when the service is
   * already up, so this firing alongside boot and the resume listener costs one guard check
   * rather than a re-post of the duty notification — which is what used to flicker the shade.
   */
  useEffect(() => {
    void rememberDutyState(onDuty).then(() => {
      if (onDuty) return ensureDutyMachinery();
      return undefined;
    });
  }, [onDuty]);

  /**
   * The trip this driver is already on, if any — the banner's source.
   *
   * `refetchOnMount` plus the focus refetch below keep it honest: completing a trip navigates
   * back here, and a stale cache would leave a banner pointing at a finished job.
   */
  const activeTrip = useQuery({
    queryKey: keys.trip.current(),
    queryFn: ({ signal }) => getCurrentTrip(signal),
  });

  /**
   * TRIPS THIS DRIVER HOLDS FOR LATER — an admin can hand out a booking days before its pickup.
   *
   * Those deliberately do NOT come back from `/driver/bookings/current`: a booking assigned for
   * next Saturday would otherwise be "the trip you are on" from the moment it is assigned, and
   * `gate.tsx` would re-route the driver onto it on every launch between now and then. The fence
   * is right, but it leaves an accepted job invisible — so it surfaces here instead, and becomes
   * the live trip on its own at T−lead.
   *
   * Read off the history list rather than a new endpoint: `GET /driver/bookings` already returns
   * everything this driver holds, `ASSIGNED` rows included.
   */
  const upcoming = useQuery({
    queryKey: keys.trip.list(),
    queryFn: ({ signal }) => listTrips(signal),
    select: (response) =>
      response.bookings
        .filter(
          (booking) =>
            booking.status === 'ASSIGNED' && Date.parse(booking.scheduled_at) > Date.now(),
        )
        .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at)),
  });

  // The trip the driver is actively on is never also "upcoming" — it has left the fence behind.
  const upcomingTrips = (upcoming.data ?? []).filter(
    (booking) => booking.id !== activeTrip.data?.booking?.id,
  );

  /**
   * `undefined` while the first read is in flight, so the banner does not flash in and out on a
   * cold start. `true` means Android is still battery-optimising this app.
   *
   * Re-read on every focus, and that is load-bearing rather than tidy: the driver leaves this
   * screen for the system settings and comes straight back, so the focus event is the moment the
   * answer changes. It also catches the case the old stored flag could not — a system update that
   * silently re-enables optimisation on a driver who set it up weeks ago.
   */
  const [needsBattery, setNeedsBattery] = useState<boolean | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void needsBatterySetup().then((value) => {
        if (active) setNeedsBattery(value);
      });
      // Re-read the live trip on every focus too: completing one lands back here, and a banner
      // still offering to resume a finished trip is worse than no banner at all.
      void queryClient.invalidateQueries({ queryKey: keys.trip.current() });
      return () => {
        active = false;
      };
    }, [queryClient]),
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

        {/*
          THE SECOND WAY BACK INTO A TRIP. `gate.tsx` routes a killed app straight into one on
          launch; this catches the driver who is already in the app and navigated out of the trip
          screen — back button, a tab tap — and would otherwise have no route back to a job the
          customer is still waiting on. Re-read on focus, so ending a trip clears it immediately.

          Above the battery banner deliberately: a live trip outranks a setup nudge.
        */}
        {activeTrip.data?.booking != null ? (
          <Pressable
            onPress={() => router.push(`/trip/${activeTrip.data?.booking?.id ?? ''}`)}
            accessibilityRole="button"
            accessibilityLabel="Resume your trip in progress"
            style={({ pressed }) => [styles.tripBanner, pressed && styles.tripBannerPressed]}
          >
            <View style={styles.tripBannerIcon}>
              <Feather name="navigation" size={16} color={colors.dutyOn} />
            </View>
            <View style={styles.batteryText}>
              <Text style={styles.tripBannerTitle}>Trip in progress</Text>
              <Text style={styles.batteryBody}>
                {activeTrip.data.booking.reference} · tap to carry on
              </Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.dutyOn} />
          </Pressable>
        ) : null}

        {/*
          BOOKED FOR LATER. Below the live-trip banner and above the battery nudge: a job the
          driver already holds outranks a setup reminder, and a job happening right now outranks
          both. Absent entirely when there are none, which is most of the time.
        */}
        {upcomingTrips.length === 0 ? null : (
          <View style={styles.upcoming}>
            <Text style={styles.upcomingHeading}>Booked for later</Text>
            {upcomingTrips.map((booking) => (
              <Pressable
                key={booking.id}
                onPress={() => router.push(`/trip/${booking.id}`)}
                accessibilityRole="button"
                accessibilityLabel={`Trip ${booking.reference}, ${formatWhen(booking.scheduled_at)}`}
                style={({ pressed }) => [styles.upcomingRow, pressed && styles.upcomingRowPressed]}
              >
                <View style={styles.upcomingIcon}>
                  <Feather name="calendar" size={15} color={colors.warning} />
                </View>
                <View style={styles.batteryText}>
                  <Text style={styles.upcomingTitle}>
                    {formatWhen(booking.scheduled_at)}
                  </Text>
                  <Text style={styles.batteryBody} numberOfLines={1}>
                    {booking.pickup.address} → {booking.drop.address}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.faint} />
              </Pressable>
            ))}
          </View>
        )}

        {/*
          THE SCHEDULED BOARD — trips booked ahead that nobody has taken.

          Shown only ON DUTY, alongside the rest of the work surface: a driver who has gone
          offline for the night is not browsing for Thursday, and an off-duty Home is deliberately
          quiet. It carries no count, because knowing how many are waiting would cost a request on
          every Home render for a list most drivers open occasionally and by choice.

          Below "Booked for later" on purpose: trips they already hold outrank trips they might.

          WRAPPED IN `upcoming` LIKE THE GROUP ABOVE IT, even though it is a single row. That
          wrapper is what carries the gap to the next block — a bare row carried only the 4dp that
          separates SIBLING rows, so this one sat almost touching the duty card while the group
          above it had 20dp. Same wrapper, same spacing, no special case.
        */}
        {onDuty ? (
          <View style={styles.upcoming}>
            <Pressable
              onPress={() => router.push('/scheduled-board')}
              accessibilityRole="button"
              accessibilityLabel="Trips you can take, booked ahead"
              style={({ pressed }) => [styles.upcomingRow, pressed && styles.upcomingRowPressed]}
            >
              <View style={styles.upcomingIcon}>
                <Feather name="calendar" size={15} color={colors.warning} />
              </View>
              <View style={styles.batteryText}>
                <Text style={styles.upcomingTitle}>Trips you can take</Text>
                <Text style={styles.batteryBody} numberOfLines={1}>
                  Booked ahead, waiting for a driver
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color={colors.faint} />
            </Pressable>
          </View>
        ) : null}

        {needsBattery === true ? (
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
  tripBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.dutyOnBg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dutyOn,
    padding: space.md,
    marginBottom: space.md,
  },
  tripBannerPressed: { opacity: 0.85 },
  tripBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripBannerTitle: { ...text.label, color: colors.dutyOn },
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
    marginBottom: space.md,
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

  /* Quieter than the live-trip banner above it on purpose: these are jobs to know about, not jobs
     to act on. A second green card would compete with the one trip that is actually happening. */
  /*
   * EVERY BLOCK ON THIS SCREEN LEAVES THE SAME GAP BELOW IT, and `space.md` is that gap — see
   * `tripBanner` and `batteryBanner`, which now match. One step down the scale from `lg`, which
   * read as too airy on a screen whose whole job is to be scanned at a glance.
   *
   * THE GAPS USED TO COME FROM THREE PLACES AT ONCE. This wrapper added 16, each row inside it
   * added its own 4, the lone board row added only that 4, and the battery banner added 40 — so
   * the same visual seam measured 20dp in one place, 4dp in the next and 40dp in the third, and
   * the duty card sat hard against whatever happened to precede it.
   *
   * `gap` separates the rows INSIDE a group; `marginBottom` separates the group from what comes
   * next. Two jobs, two properties, and neither one doubles up with the other.
   */
  upcoming: { marginBottom: space.md, gap: space.xs },
  upcomingHeading: {
    ...text.caption,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: space.xs,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  upcomingRowPressed: { opacity: 0.9 },
  upcomingIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: '#FFF6E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingTitle: { ...text.label, color: colors.fg },

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
