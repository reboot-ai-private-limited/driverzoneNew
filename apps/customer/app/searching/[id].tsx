import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { GlassPanel } from '@/components/GlassPanel';
import { MapCanvas, type MapMarker } from '@/components/MapCanvas';
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
 * ON THE MAP, NOT ON A BLANK PAGE. This was a radar animation centred on white: a good waiting
 * graphic about nothing in particular. The customer has just chosen two points on a map and the
 * question in their head is spatial — where am I, where is this going, is anyone near me. So the
 * map they booked on stays on screen and the search happens ON it: the pulse now emanates from
 * their actual pickup pin, over their actual streets, with the route to their destination drawn
 * underneath. The animation is the same idea; it is just anchored to something real now.
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
  const insets = useSafeAreaInsets();
  const [cancelling, setCancelling] = useState(false);

  /**
   * How much of the map the bottom card covers.
   *
   * Handed to `MapCanvas` as `bottomInset` so the map's own centre is the middle of the VISIBLE
   * strip rather than the middle of the screen — otherwise centring on the pickup would park the
   * pin behind the card, which is the one thing this screen is about.
   */
  const [cardHeight, setCardHeight] = useState(0);

  const booking = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: () => getBooking(id),
    /*
     * THE SCHEDULED EXEMPTION IS GONE, for the same reason the redirect above it is.
     *
     * This used to stop polling a scheduled booking sitting at `CONFIRMED` — "a status that cannot
     * change for days" — which was true when nothing was dispatched until T−90. It is now the
     * exact booking that is about to change: the early ring moves it to `SEARCHING` within
     * seconds. Leaving the exemption in would freeze this screen on the first frame it rendered
     * and never show the search it was opened for.
     */
    refetchInterval: (query) => {
      const data = query.state.data;
      return data === undefined || SEARCHING_STATUSES.has(data.status) ? 3000 : false;
    },
  });

  const status = booking.data?.status;

  /*
   * A BOOKING FOR NEXT WEEK **IS** A SEARCH NOW, which is why this guard is gone.
   *
   * It used to read `is_scheduled === true && status === 'CONFIRMED'` and send those bookings to
   * the trip screen, because a scheduled booking was not dispatched until ninety minutes before
   * its pickup and this screen would have animated a search that had not started.
   *
   * Every scheduled booking is now rung for the moment it is made
   * (docs/LLD/dispatch-and-assignment.md §Ring early, park, ring again), so `CONFIRMED` means the
   * same thing it means for an immediate booking: the dispatch job is queued and about to run.
   * Keeping the guard would have bounced every customer straight back out of the screen they had
   * just been sent to — the trip is scheduled, the status is CONFIRMED for the second before the
   * worker picks it up, and out they go.
   *
   * WHAT REPLACES IT IS THE HANDOFF BELOW, unchanged: the moment the booking stops being one of
   * `SEARCHING_STATUSES` this screen is done. A driver found leaves via `ASSIGNED`; an early ring
   * that found nobody leaves via `WAITING_DRIVER`, which is deliberately absent from that set —
   * the trip screen says "Still finding you a driver" for it, which is the honest thing to show
   * once nothing is actively ringing.
   */

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

  /**
   * Both ends of the trip, so the map draws its route bow between them rather than a lone pin.
   *
   * Rebuilt only when a coordinate actually moves — which on this screen is never, since the
   * booking's points are frozen. Memoised anyway because a fresh array identity every poll would
   * re-run `MapCanvas`'s marker-snapshot pass every three seconds.
   */
  const markers = useMemo<MapMarker[]>(() => {
    const data = booking.data;
    if (data === undefined) return [];
    return [
      {
        id: 'pickup',
        lat: data.pickup.lat,
        lng: data.pickup.lng,
        kind: 'pickup',
        title: data.pickup.address,
      },
      { id: 'drop', lat: data.drop.lat, lng: data.drop.lng, kind: 'drop', title: data.drop.address },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    booking.data?.pickup.lat,
    booking.data?.pickup.lng,
    booking.data?.drop.lat,
    booking.data?.drop.lng,
  ]);

  if (booking.isPending) {
    return (
      <View style={styles.plain}>
        <ActivityIndicator size="large" color={colors.muted} />
      </View>
    );
  }

  if (booking.isError || booking.data === undefined) {
    return (
      <View style={styles.plain}>
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
    );
  }

  const data = booking.data;

  return (
    <View style={styles.root}>
      {/*
        CENTRED ON THE PICKUP, not framed to the whole route.

        `frameRoute={false}` IS WHAT MAKES THAT TRUE. Passing a pickup and a drop otherwise tells
        `MapCanvas` to pull the camera back until both are on screen, which is right for choosing a
        trip and wrong for waiting on one: a drop 40km away puts the customer's own street under a
        single pixel, and the sweep — which is anchored to the middle of the visible strip — then
        pulses over the midpoint of the route instead of over them. The search is happening AT the
        pickup, so that is where the camera sits and where the rings come from.

        The route bow is still drawn, running off the edge of the screen. That is the right amount
        of "and then we go over there" for a screen about who is coming to fetch you.

        AND THE CAMERA IS LOCKED THERE. `interactive={false}` is what makes "centred on the pickup"
        a fact for the whole wait rather than just the first frame: the sweep below is a fixed
        overlay at the middle of the visible strip, so one stray drag would leave it pulsing over
        empty ground with the pin it belongs to shoved off to the side. There is nothing on this
        screen to look around for — the map is here to say WHERE you are waiting, not to be read.
      */}
      <MapCanvas
        initialCentre={{ lat: data.pickup.lat, lng: data.pickup.lng }}
        initialZoom="street"
        markers={markers}
        frameRoute={false}
        interactive={false}
        bottomInset={cardHeight}
      />

      {/*
        THE SWEEP, over the map rather than in it.

        A `<Marker>` with an animating child forces `tracksViewChanges` on, which re-rasterises the
        marker into a native bitmap every frame — a known Android jank source, and the exact reason
        `MapCanvas`'s own pickup glyph is a static halo instead of a pulse. Drawn here as a plain
        screen-space overlay it costs nothing.

        IT LANDS ON THE PICKUP PIN because two things agree about where the middle is: the camera
        is centred on the pickup and never pulled back to frame the route, and `bottomInset` is
        passed as native map padding so the camera's centre RENDERS in the middle of the strip
        above the card rather than the middle of the screen. This layer spans exactly that strip.
      */}
      <View style={[styles.sweepLayer, { bottom: cardHeight }]} pointerEvents="none">
        <Sweep />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <GlassPanel rounded="pill" style={styles.elapsedGlass}>
          <View style={styles.elapsedRow}>
            <LiveDot />
            <ElapsedChipLabel />
          </View>
        </GlassPanel>
      </View>

      <Animated.View
        entering={FadeInDown.duration(260)}
        style={[styles.card, { paddingBottom: insets.bottom + space.lg }]}
        onLayout={(event) => setCardHeight(event.nativeEvent.layout.height)}
      >
        <View style={styles.grabber} />

        <Text style={styles.title}>
          {ringingFavourites ? 'Ringing your favourite drivers' : (copy?.title ?? 'Confirming your booking')}
        </Text>
        <Text style={styles.body}>
          {ringingFavourites
            ? 'If none of them takes it, we will look for everyone else straight away.'
            : (copy?.body ?? 'This only takes a moment.')}
        </Text>

        <View style={styles.route}>
          <View style={styles.routeRow}>
            <View style={styles.routeIconBubble}>
              <View style={styles.dotPickup} />
            </View>
            <Text style={styles.routeText} numberOfLines={1}>
              {data.pickup.address}
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
              {data.drop.address}
            </Text>
          </View>
        </View>

        <Animated.View entering={FadeIn.duration(240).delay(200)}>
          <Pressable
            onPress={() => setCancelling(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cancelLink, pressed && styles.cancelLinkPressed]}
          >
            <Feather name="x" size={14} color={colors.danger} />
            <Text style={styles.cancelLinkLabel}>Cancel this search</Text>
          </Pressable>
        </Animated.View>
      </Animated.View>

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
 * A ticking "Searching for 0:12", the one piece of proof that time is passing and nothing has
 * frozen. Counts from when THIS component mounted, not from the booking's own timestamps: it is
 * answering "how long have I been looking at this screen", not "how long has the booking
 * existed" — those can differ by however long the previous screen (Confirm, or a re-open) took.
 */
function ElapsedChipLabel(): ReactElement {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const minutes = Math.floor(seconds / 60);
  const display = `${String(minutes)}:${String(seconds % 60).padStart(2, '0')}`;

  return <Text style={styles.elapsedText}>Searching for {display}</Text>;
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
const RING_DELAY_MS = 700;
const RING_DURATION_MS = 2600;

/** The widest a ring gets, in points — roughly "a few streets" at the map's street zoom. */
const SWEEP_MAX = 260;
/** Where a ring starts: just outside `MapCanvas`'s own pickup halo, so it grows out of the pin. */
const SWEEP_MIN = 44;

/**
 * Rings growing outward from the pickup pin, three of them, each a beat behind the last.
 *
 * TRANSLUCENT AND OUTLINED, unlike the solid discs this was on white. Over a map a filled shape
 * hides the streets it is supposed to be sweeping, which reads as a loading overlay rather than a
 * search — the thing being animated has to stay visible through it. So each ring is a soft yellow
 * wash with a brighter rim, and it fades out entirely before it reaches its full size.
 *
 * NO CORE GLYPH any more. The map already draws a pickup marker at this exact point; a second
 * icon on top of it was two pins for one place.
 */
function Sweep(): ReactElement {
  return (
    <View style={styles.sweepBox}>
      {Array.from({ length: RING_COUNT }, (_, index) => (
        <SweepRing key={index} delayMs={index * RING_DELAY_MS} />
      ))}
    </View>
  );
}

function SweepRing({ delayMs }: { delayMs: number }): ReactElement {
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

  /*
   * Scale, not width/height: an animated layout property re-measures the view every frame on the
   * JS thread, while a transform runs on the UI thread and survives a busy render — and this
   * screen re-renders on every poll.
   */
  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - progress.value),
    transform: [{ scale: (SWEEP_MIN + (SWEEP_MAX - SWEEP_MIN) * progress.value) / SWEEP_MIN }],
  }));

  return <Animated.View style={[styles.sweepRing, ringStyle]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  /** The loading and error states, which have no map to sit on — there is no centre to draw yet. */
  plain: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
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

  // Spans the map down to the top of the card, so its centre is the map's centre — which is the
  // pickup. `bottom` is set inline from the measured card height.
  sweepLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sweepBox: { width: SWEEP_MAX, height: SWEEP_MAX, alignItems: 'center', justifyContent: 'center' },
  sweepRing: {
    position: 'absolute',
    width: SWEEP_MIN,
    height: SWEEP_MIN,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(242, 242, 0, 0.35)',
    borderWidth: 2,
    borderColor: colors.brand,
  },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center' },
  elapsedGlass: { paddingHorizontal: space.md, paddingVertical: space.xs },
  elapsedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  elapsedText: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },

  /*
   * OPAQUE, not glass. `GlassPanel`'s own header is explicit that frosting is for the small
   * controls floating over the map — everything in a bottom sheet stays solid, because the copy
   * inside it has to be readable over whatever tile happens to be underneath.
   */
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    ...shadow.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: space.md,
  },
  title: { ...text.heading, color: colors.fg },
  body: { ...text.body, color: colors.muted, marginTop: space.xs },

  route: {
    marginTop: space.md,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.md,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center' },
  routeIconBubble: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
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
   * solid red bar under a live search reads as the search having failed rather than as something
   * the customer may optionally do.
   */
  cancelLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    marginTop: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  cancelLinkPressed: { backgroundColor: colors.dangerSoft },
  cancelLinkLabel: { ...text.label, color: colors.danger },
});
