import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { CancelRide } from '@/components/CancelRide';
import { tripStatusCopy } from '@/features/booking/status';
import { getBooking } from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

/**
 * The gap between Confirm and the trip screen — its own page, not a state the trip screen just
 * renders inline.
 *
 * WHY A SEPARATE ROUTE. The trip screen (`app/trip/[id].tsx`) already renders `SEARCHING` as one
 * state among many on a scrollable receipt-shaped page, which is the right density for a booking
 * you are checking on later. It is the wrong density for the ninety seconds right after Confirm,
 * where the only thing worth showing is "we are looking, hold on" — full-screen, animated, and
 * with nothing else competing for attention.
 *
 * OWNS NOTHING. It polls the same `GET /customer/bookings/:id` the trip screen does and hands off
 * the instant the answer stops being "still looking": found a driver → the trip screen, gave up
 * → the trip screen. Both outcomes land on the SAME page because `tripStatusCopy` and
 * `isTerminalStatus` there already render `NO_DRIVER_FOUND` correctly — building a second "sorry"
 * screen here would just be two places that can disagree about what it says.
 */
const SEARCHING_STATUSES = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'SEARCHING']);

export default function SearchingScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState(false);

  const booking = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: () => getBooking(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || SEARCHING_STATUSES.has(status) ? 3000 : false;
    },
  });

  const status = booking.data?.status;

  // THE HANDOFF. The moment the status is no longer one of the "still looking" ones — driver
  // found, gave up, or the customer's own cancel just now — this page is done and the trip
  // screen takes over. `replace`, not `push`: this screen must not be a back-button destination
  // once the answer exists, or leaving the trip screen would land back on a search that is over.
  useEffect(() => {
    if (status !== undefined && !SEARCHING_STATUSES.has(status)) {
      router.replace(`/trip/${id}`);
    }
  }, [status, id]);

  const copy = status === undefined ? null : tripStatusCopy(status);

  /**
   * The favourite wave is the first thing that rings, so while the booking is still SEARCHING and
   * the customer asked for their own drivers, say so.
   *
   * ONLY WHILE SEARCHING, and it says the fall-through out loud. This is not a promise about who
   * ends up driving — the search opens to everyone within the minute — and a line that read like
   * one would be a broken promise most of the time.
   */
  const ringingFavourites = status === 'SEARCHING' && booking.data?.prefer_favourite_drivers === true;

  return (
    <View style={styles.root}>
      {booking.isPending ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : booking.isError ? (
        <View style={styles.centre}>
          <Text style={styles.loadError}>We could not check on this booking.</Text>
          <Pressable
            onPress={() => void booking.refetch()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Feather name="refresh-cw" size={15} color={colors.fg} />
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.centre}>
            <Radar />

            <Animated.View entering={FadeInDown.duration(260).delay(100)} style={styles.textBlock}>
              <Text style={styles.title}>
                {ringingFavourites ? 'Ringing your favourite drivers' : (copy?.title ?? 'Confirming your booking')}
              </Text>
              <Text style={styles.body}>
                {ringingFavourites
                  ? 'If none of them takes it, we will look for everyone else straight away.'
                  : (copy?.body ?? 'This only takes a moment.')}
              </Text>
              <ElapsedChip />
            </Animated.View>

            {booking.data === undefined ? null : (
              <Animated.View
                entering={FadeInDown.duration(260).delay(200)}
                style={styles.routeCard}
              >
                <Text style={styles.routeCardTitle}>Your trip</Text>
                <View style={styles.routeRow}>
                  <View style={styles.routeIconBubble}>
                    <View style={styles.dotPickup} />
                  </View>
                  <Text style={styles.routeText} numberOfLines={1}>
                    {booking.data.pickup.address}
                  </Text>
                </View>
                <View style={styles.routeConnector}>
                  <View style={styles.routeLine} />
                </View>
                <View style={styles.routeRow}>
                  <View style={styles.routeIconBubble}>
                    <View style={styles.dotDrop} />
                  </View>
                  <Text style={styles.routeText} numberOfLines={1}>
                    {booking.data.drop.address}
                  </Text>
                </View>
              </Animated.View>
            )}
          </View>

          <Animated.View entering={FadeIn.duration(240).delay(320)}>
            <Pressable
              onPress={() => setCancelling(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancelLink, pressed && styles.cancelLinkPressed]}
            >
              <Feather name="x" size={14} color={colors.danger} />
              <Text style={styles.cancelLinkLabel}>Cancel this search</Text>
            </Pressable>
          </Animated.View>
        </>
      )}

      <CancelRide
        visible={cancelling}
        bookingId={id}
        onClose={() => setCancelling(false)}
        onCancelled={(result) => {
          setCancelling(false);
          queryClient.setQueryData(keys.bookings.detail(id), result.booking);
        }}
      />
    </View>
  );
}

/**
 * A ticking "Searching for 0:12" chip, with its own small pulsing dot — the one piece of proof on
 * this whole screen that time is actually passing and nothing has frozen. Counts from when THIS
 * component mounted, not from the booking's own timestamps: it is answering "how long have I been
 * looking at this screen", not "how long has the booking existed" — those can differ by however
 * long the previous screen (Confirm, or a re-open) took.
 */
function ElapsedChip(): ReactElement {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(seconds / 60);
  const display = `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <View style={styles.elapsedChip}>
      <LiveDot />
      <Text style={styles.elapsedText}>Searching for {display}</Text>
    </View>
  );
}

function LiveDot(): ReactElement {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.4 + pulse.value * 0.6,
  }));

  return <Animated.View style={[styles.liveDot, dotStyle]} />;
}

const RING_COUNT = 3;
const RING_DELAY_MS = 550;
const RING_DURATION_MS = 1800;

const ORBIT_DOT_COUNT = 2;
const ORBIT_DURATION_MS = 3400;

/**
 * Three rings, staggered rather than started together — a single pulsing ring reads as a
 * heartbeat monitor; three overlapping ones, each a beat behind the last, read as something
 * actively searching outward. Two small dots orbit the whole ring stack in the opposite sense of
 * the outward pulse, so the eye has a second, independent motion to track — the pulse alone reads
 * as a beacon; the orbit on top of it reads as a live radar sweep. The core glyph breathes (a
 * slow, small scale-up/down) and turns continuously, like a compass needle settling on a signal
 * rather than a static icon dropped in the middle.
 */
function Radar(): ReactElement {
  const breathe = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    breathe.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.ease) }), -1, true);
    spin.value = withRepeat(withTiming(1, { duration: 4000, easing: Easing.linear }), -1, false);
  }, [breathe, spin]);

  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breathe.value * 0.06 }],
  }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.radarWrap}>
      <View style={styles.radarBackdrop} />
      {Array.from({ length: RING_COUNT }, (_, index) => (
        <RadarRing key={index} delayMs={index * RING_DELAY_MS} />
      ))}
      {Array.from({ length: ORBIT_DOT_COUNT }, (_, index) => (
        <OrbitDot key={index} delayMs={(index * ORBIT_DURATION_MS) / ORBIT_DOT_COUNT} />
      ))}
      <Animated.View style={[styles.radarCore, coreStyle]}>
        <Animated.View style={iconStyle}>
          <Feather name="navigation" size={30} color={colors.fg} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function RadarRing({ delayMs }: { delayMs: number }): ReactElement {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withRepeat(
        withTiming(1, { duration: RING_DURATION_MS, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      ),
    );
  }, [delayMs, progress]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.5 * (1 - progress.value),
    transform: [{ scale: 1 + progress.value * 1.8 }],
  }));

  return <Animated.View style={[styles.radarRing, ringStyle]} />;
}

/** A small dot sweeping around the outside of the ring stack — orbit radius sits just past them. */
function OrbitDot({ delayMs }: { delayMs: number }): ReactElement {
  const angle = useSharedValue(0);

  useEffect(() => {
    angle.value = withDelay(
      delayMs,
      withRepeat(withTiming(360, { duration: ORBIT_DURATION_MS, easing: Easing.linear }), -1, false),
    );
  }, [delayMs, angle]);

  const orbitStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${angle.value}deg` }],
  }));

  return (
    <Animated.View style={[styles.orbitPivot, orbitStyle]}>
      <View style={styles.orbitDot} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },

  loadError: { ...text.body, color: colors.muted, marginBottom: space.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryPressed: { backgroundColor: colors.bgSunken },
  retryLabel: { ...text.label, color: colors.fg },

  radarWrap: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xl,
  },
  // A still disc behind the pulsing rings — without it the rings have nothing to read as
  // "growing FROM", and the animation looks like three separate shapes rather than one radar.
  radarBackdrop: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
  },
  radarRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  radarCore: {
    width: 88,
    height: 88,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.bg,
    ...shadow.card,
  },
  // Fills the same 180x180 box as radarWrap so rotating it turns around the exact same centre
  // point as the rings and core — the dot itself just sits near the top edge of that box.
  orbitPivot: {
    position: 'absolute',
    width: 180,
    height: 180,
    alignItems: 'center',
  },
  orbitDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 2,
    backgroundColor: colors.brand,
    ...shadow.soft,
  },

  textBlock: { alignItems: 'center', marginBottom: space.xl },
  title: { ...text.title, color: colors.fg, textAlign: 'center' },
  body: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.xs },

  elapsedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    marginTop: space.md,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  elapsedText: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },

  routeCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  routeCardTitle: {
    ...text.caption,
    color: colors.muted,
    fontFamily: fontFamily.semibold,
    marginBottom: space.sm,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  routeIconBubble: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  dotPickup: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  dotDrop: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  routeConnector: { paddingLeft: 10 },
  routeLine: { width: 1, height: 12, backgroundColor: colors.border },
  routeText: { ...text.caption, color: colors.fg, flex: 1 },

  /*
   * OUTLINED IN RED, not filled. This is the only affordance on a screen that is otherwise pure
   * waiting, so it has to be findable at a glance — but it is also the destructive one, and a
   * solid red bar under a radar animation reads as the search having failed rather than as
   * something the customer may optionally do.
   */
  cancelLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: space.lg,
    marginBottom: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  cancelLinkPressed: { backgroundColor: colors.dangerSoft },
  cancelLinkLabel: { ...text.label, color: colors.danger, fontFamily: fontFamily.semibold },
});
