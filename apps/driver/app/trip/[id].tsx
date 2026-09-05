import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingDto, BookingStatus } from '@driverzone/contracts';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { type ComponentProps, type ReactElement, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { CancelTripSheet } from '@/components/CancelTripSheet';
import { OtpInput } from '@/components/OtpInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { RateCustomer } from '@/components/RateCustomer';
import { SlideToConfirm } from '@/components/SlideToConfirm';
import { currentFix } from '@/duty/locationPings';
import { isDriverCancellable } from '@/features/trip/cancellation';
import { ApiError } from '@/lib/api/ApiError';
import { getDriverSettings } from '@/lib/api/endpoints/driver';
import {
  completeTrip,
  getTrip,
  goEnRoute,
  markArrived,
  reportPickupPin,
  startTrip,
} from '@/lib/api/endpoints/trip';
import { keys } from '@/lib/query/keys';
import { colors, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * THE TRIP — everything a driver does between winning an offer and being paid for it.
 *
 * **The server owns the state machine; this screen renders whichever step it is on.** Each action
 * returns the booking as it stands after the transition and that answer is written straight into
 * the cache, so the screen never advances on an assumption. A trip that moved elsewhere — support
 * forced an arrival, the customer cancelled — simply renders where it actually is on the next
 * poll rather than showing a step that is no longer true.
 *
 *   ASSIGNED ─▶ DRIVER_EN_ROUTE ─▶ ARRIVED ─▶ STARTED ─▶ COMPLETED
 *
 * **Two gates behave differently on purpose, and the UI has to match.** Arrival BLOCKS beyond
 * `dispatch.arrival_radius_m`, because reaching ARRIVED starts the customer's waiting-charge
 * clock — so a refusal here is a real refusal, and the way past it is `pin-report`, not a retry.
 * Start only WARNS about location, because by then the customer is in the car and blocking would
 * strand a trip that is genuinely happening.
 *
 * **It polls.** Same reason the customer's trip screen does: nothing pushes to this screen yet, and
 * a driver whose trip was cancelled under them must find out without pulling to refresh. The
 * interval stops itself once the trip reaches a terminal state.
 */

/** Alive statuses poll; terminal ones stop. Kept as a set so the check reads as one idea. */
const TERMINAL: ReadonlySet<BookingStatus> = new Set<BookingStatus>([
  'COMPLETED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_DRIVER',
  'CANCELLED_BY_ADMIN',
  'EXPIRED',
  'NO_DRIVER_FOUND',
]);

/** The four steps a driver walks, in order. Anything else renders as an end state. */
const STEPS: ReadonlyArray<{ status: BookingStatus; short: string }> = [
  { status: 'ASSIGNED', short: 'Accepted' },
  { status: 'DRIVER_EN_ROUTE', short: 'On the way' },
  { status: 'ARRIVED', short: 'At pickup' },
  { status: 'STARTED', short: 'In trip' },
];

export default function TripScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const trip = useQuery({
    queryKey: keys.trip.detail(id),
    queryFn: ({ signal }) => getTrip(id, signal),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && TERMINAL.has(status) ? false : 6000;
    },
  });

  const booking = trip.data ?? null;
  const status = booking?.status ?? null;

  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Set when the arrival gate refuses, so the pin-report way out can be offered in its place. */
  const [tooFar, setTooFar] = useState<{ away: number; allowed: number } | null>(null);
  const [pinReported, setPinReported] = useState(false);
  /** Set once the customer has been rated, so the form does not reappear on this screen. */
  const [rated, setRated] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  /**
   * The penalty figures, so the cancel sheet can state what dropping this trip costs BEFORE the
   * driver commits. Long-lived: these are admin settings that change perhaps twice a year, and a
   * refetch on every trip screen would be a request per trip for an answer that never moves.
   */
  const settings = useQuery({
    queryKey: keys.settings.mine(),
    queryFn: ({ signal }) => getDriverSettings(signal),
    staleTime: 60 * 60 * 1000,
  });

  /** Every action writes the returned booking straight back — see the header. */
  function adopt(next: BookingDto): void {
    queryClient.setQueryData(keys.trip.detail(id), next);
    void queryClient.invalidateQueries({ queryKey: keys.offers.all() });
  }

  function fail(cause: unknown, fallback: string): void {
    setError(cause instanceof Error ? cause.message : fallback);
  }

  const enRoute = useMutation({
    mutationFn: () => goEnRoute(id),
    onMutate: () => setError(null),
    onSuccess: adopt,
    onError: (cause) => fail(cause, 'Could not start the trip.'),
  });

  const arrive = useMutation({
    mutationFn: async () => {
      const fix = await currentFix();
      if (fix === null) throw new Error('We could not confirm your location. Check your GPS.');
      return markArrived(id, fix);
    },
    onMutate: () => {
      setError(null);
      setTooFar(null);
    },
    onSuccess: (next) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      adopt(next);
    },
    onError: (cause) => {
      /*
       * The refusal is DATA, not just a message. `DRIVER_NOT_AT_PICKUP` carries how far off the
       * driver is, and telling them "you are 800 m away, the limit is 500" is the difference
       * between a rule they can act on and a button that mysteriously will not work.
       */
      if (cause instanceof ApiError && cause.code === 'DRIVER_NOT_AT_PICKUP') {
        const details = cause.data as { distance_metres?: number; allowed_metres?: number } | null;
        setTooFar({
          away: Math.round(details?.distance_metres ?? 0),
          allowed: Math.round(details?.allowed_metres ?? 0),
        });
        return;
      }
      fail(cause, 'Could not mark you as arrived.');
    },
  });

  const start = useMutation({
    mutationFn: async (code: string) => {
      // Sent when we have it, omitted when we do not — start warns rather than blocks on location.
      const fix = await currentFix();
      return fix === null ? startTrip(id, code) : startTrip(id, code, { lat: fix.lat, lng: fix.lng });
    },
    onMutate: () => setError(null),
    onSuccess: (next) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOtp('');
      adopt(next);
    },
    onError: (cause) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Clear the boxes: a wrong code left in place invites the driver to re-submit the same one.
      setOtp('');
      fail(cause, 'That code did not work.');
    },
  });

  const finish = useMutation({
    mutationFn: () => completeTrip(id),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      adopt(result.booking);
      void queryClient.invalidateQueries({ queryKey: keys.earnings.all() });
      // The trip has just joined the history. Without this the Trips tab still shows it as live
      // until its next focus refetch, which is the one moment a driver is most likely to look.
      void queryClient.invalidateQueries({ queryKey: keys.trip.list() });
    },
    onError: (cause) => fail(cause, 'Could not complete the trip.'),
  });

  const reportPin = useMutation({
    mutationFn: async () => {
      const fix = await currentFix();
      if (fix === null) throw new Error('We could not confirm your location. Check your GPS.');
      return reportPickupPin(id, { lat: fix.lat, lng: fix.lng });
    },
    onSuccess: () => setPinReported(true),
    onError: (cause) => fail(cause, 'Could not report the pin.'),
  });

  if (trip.isPending) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={colors.fg} />
      </View>
    );
  }

  if (trip.isError || booking === null) {
    return (
      <View style={styles.centred}>
        <Feather name="alert-circle" size={30} color={colors.muted} />
        <Text style={styles.centredTitle}>Could not load this trip</Text>
        <Text style={styles.centredBody}>
          {trip.error instanceof Error ? trip.error.message : 'Please try again.'}
        </Text>
        <Pressable onPress={() => void trip.refetch()} accessibilityRole="button" style={styles.retry}>
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
        <Pressable onPress={() => router.replace('/home')} accessibilityRole="button" style={styles.textAction}>
          <Text style={styles.textActionLabel}>Back to duty</Text>
        </Pressable>
      </View>
    );
  }

  const cash = booking.payment_mode === 'CASH';

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace('/home')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to duty"
        >
          <Feather name="chevron-left" size={24} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>{booking.reference}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Stepper status={booking.status} />

        <Animated.View layout={LinearTransition.springify().damping(18)}>
          <StatusHeadline status={booking.status} />
        </Animated.View>

        {/* Where to go. The pickup is the live one until the trip starts, then the drop is. */}
        <Animated.View entering={FadeInDown.duration(260)} style={styles.card}>
          <Waypoint
            icon="map-pin"
            label="Pick up"
            address={booking.pickup.address}
            active={booking.status !== 'STARTED'}
            onNavigate={() => openMaps(booking.pickup.lat, booking.pickup.lng, booking.pickup.address)}
          />
          <View style={styles.waypointRule} />
          <Waypoint
            icon="flag"
            label="Drop"
            address={booking.drop.address}
            active={booking.status === 'STARTED'}
            onNavigate={() => openMaps(booking.drop.lat, booking.drop.lng, booking.drop.address)}
          />
        </Animated.View>

        <View style={styles.metaRow}>
          <Meta icon="tag" label="Fare" value={booking.fare.total.amount_display} />
          <Meta
            icon={cash ? 'dollar-sign' : 'credit-card'}
            label="Payment"
            value={cash ? 'Cash' : 'Prepaid'}
          />
        </View>

        {/*
          Who the driver is picking up, and how to reach them. `customer.phone` is sent by the
          server ONLY while the trip is live — see `PHONE_VISIBLE_STATUSES` in the API — so the
          Call button appears with ASSIGNED and is gone the moment the trip ends. Nothing to hide
          client-side: a finished trip's response never carries the number.
        */}
        {booking.customer !== null ? (
          <Animated.View entering={FadeInDown.duration(260)} style={styles.riderCard}>
            <View style={styles.riderAvatar}>
              <Feather name="user" size={18} color={colors.fg} />
            </View>
            <View style={styles.riderText}>
              <Text style={styles.riderLabel}>Your rider</Text>
              <Text style={styles.riderName} numberOfLines={1}>
                {booking.customer.name ?? 'Rider'}
              </Text>
            </View>
            {booking.customer.phone !== null ? (
              <Pressable
                onPress={() => callCustomer(booking.customer!.phone!)}
                accessibilityRole="button"
                accessibilityLabel={`Call ${booking.customer.name ?? 'the rider'}`}
                style={({ pressed }) => [styles.callButton, pressed && styles.callButtonPressed]}
              >
                <Feather name="phone" size={16} color={colors.onFg} />
                <Text style={styles.callButtonText}>Call</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}

        {/*
          The cash reminder, and only on a cash trip. A driver who forgets to collect is holding a
          debt against their own wallet by the time they find out — `CASH_COLLECTED` is a negative
          ledger row — so this says the number plainly while they are still with the customer.
        */}
        {cash && booking.status === 'STARTED' ? (
          <Animated.View entering={FadeIn} style={styles.cashNote}>
            <Feather name="dollar-sign" size={16} color={colors.warning} />
            <Text style={styles.cashNoteText}>
              Collect {booking.fare.total.amount_display} in cash before you end the trip.
            </Text>
          </Animated.View>
        ) : null}

        {error !== null ? (
          <Animated.Text entering={FadeIn} style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Animated.Text>
        ) : null}

        {/* ── The step's own action ─────────────────────────────────────────────────────── */}

        {booking.status === 'ASSIGNED' ? (
          <Animated.View entering={FadeInDown} style={styles.actions}>
            <PrimaryButton
              label="Start driving to pickup"
              onPress={() => enRoute.mutate()}
              loading={enRoute.isPending}
            />
          </Animated.View>
        ) : null}

        {booking.status === 'DRIVER_EN_ROUTE' ? (
          <Animated.View entering={FadeInDown} style={styles.actions}>
            <PrimaryButton
              label="I've reached the pickup"
              onPress={() => arrive.mutate()}
              loading={arrive.isPending}
              showArrow={false}
            />

            {tooFar !== null ? (
              <Animated.View entering={FadeIn} style={styles.gate}>
                <Text style={styles.gateTitle}>
                  You are about {formatDistance(tooFar.away)} from the pickup
                </Text>
                <Text style={styles.gateBody}>
                  You need to be within {formatDistance(tooFar.allowed)} to arrive. If the customer
                  pinned the wrong spot, tell us and our team will sort it out.
                </Text>

                {pinReported ? (
                  <View style={styles.gateDone}>
                    <Feather name="check-circle" size={16} color={colors.dutyOn} />
                    <Text style={styles.gateDoneText}>
                      Reported. Stay where you are — support will call.
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => reportPin.mutate()}
                    disabled={reportPin.isPending}
                    accessibilityRole="button"
                    style={styles.gateAction}
                  >
                    {reportPin.isPending ? (
                      <ActivityIndicator color={colors.fg} />
                    ) : (
                      <Text style={styles.gateActionLabel}>The pin is in the wrong place</Text>
                    )}
                  </Pressable>
                )}
              </Animated.View>
            ) : null}
          </Animated.View>
        ) : null}

        {booking.status === 'ARRIVED' ? (
          <Animated.View entering={FadeInDown} style={styles.actions}>
            {/*
              THE CODE COMES FROM THE CUSTOMER'S MOUTH, not from this app. `start_otp` is null on
              every driver-side read of a booking — deliberately, so that starting a trip proves
              somebody is actually standing there. Four digits, not the login screen's six.
            */}
            <Text style={styles.otpTitle}>Ask for the 4-digit code</Text>
            <Text style={styles.otpBody}>
              The customer has it in their app. The trip starts once it matches.
            </Text>

            <View style={styles.otpBox}>
              {/*
                A FIXED-WIDTH wrapper, and it is load-bearing. `OtpInput`'s cells are `flex: 1`
                with a `maxWidth`, so they need a parent of definite width to divide up — dropped
                into a shrink-wrapped centring container they resolve to zero and the boxes vanish
                to a row of dots. Four cells at 54 plus their 4px margins is 248.
              */}
              <View style={styles.otpCells}>
                <OtpInput
                  value={otp}
                  onChange={setOtp}
                  length={4}
                  editable={!start.isPending}
                  invalid={start.isError}
                  onFilled={(code) => start.mutate(code)}
                />
              </View>
            </View>

            {start.isPending ? (
              <View style={styles.otpPending}>
                <ActivityIndicator color={colors.fg} />
                <Text style={styles.otpPendingText}>Checking the code…</Text>
              </View>
            ) : null}
          </Animated.View>
        ) : null}

        {booking.status === 'STARTED' ? (
          <Animated.View entering={FadeInDown} style={styles.actions}>
            <SlideToConfirm
              label="Slide to end trip"
              onConfirm={() => finish.mutate()}
              loading={finish.isPending}
            />
          </Animated.View>
        ) : null}

        {booking.status === 'COMPLETED' ? (
          <Animated.View entering={FadeInDown} style={styles.done}>
            <View style={styles.doneIcon}>
              <Feather name="check" size={26} color={colors.dutyOn} />
            </View>
            <Text style={styles.doneTitle}>Trip complete</Text>
            <Text style={styles.doneBody}>
              {cash
                ? `You collected ${booking.fare.total.amount_display}. Your share is in your earnings.`
                : 'Your share has been added to your earnings.'}
            </Text>

            {/*
              ABOVE "Back to duty", not after it — the way out has to stay visible, but a control
              placed below the exit is one nobody scrolls to. `RateCustomer` collapses itself once
              submitted, and rating is optional either way.

              `rated` keeps it gone for the rest of this screen's life. The server would refuse a
              second attempt with "You have already rated this trip", but showing a form that can
              only fail is not something to leave up.
            */}
            {rated ? null : (
              <View style={styles.rateBlock}>
                <RateCustomer bookingId={id} onRated={() => setRated(true)} />
              </View>
            )}

            <View style={styles.doneActions}>
              <PrimaryButton
                label="Back to duty"
                onPress={() => router.replace('/home')}
                showArrow={false}
              />
              <Pressable
                onPress={() => router.replace('/earnings')}
                accessibilityRole="button"
                style={styles.textAction}
              >
                <Text style={styles.textActionLabel}>See earnings</Text>
              </Pressable>
            </View>
          </Animated.View>
        ) : null}

        {/*
          CANCELLING — last on the screen, and quiet.

          Below every action the trip actually wants, because it is the one control here that lets
          a customer down: a driver reaching for "I've arrived" must never find this under their
          thumb. Text on plain background rather than a button, for the same reason. It disappears
          entirely once the trip has STARTED — the state machine offers a driver no cancellation
          from there, so a control would only be able to produce an error.
        */}
        {isDriverCancellable(booking.status) ? (
          <Animated.View entering={FadeIn} style={styles.cancelWrap}>
            <Pressable
              onPress={() => setCancelling(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancelAction, pressed && styles.cancelActionPressed]}
            >
              <Feather name="x-circle" size={15} color={colors.danger} />
              <Text style={styles.cancelLabel}>I can’t do this trip</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {status !== null && TERMINAL.has(status) && status !== 'COMPLETED' ? (
          <Animated.View entering={FadeInDown} style={styles.done}>
            <View style={[styles.doneIcon, styles.doneIconEnded]}>
              <Feather name="x" size={26} color={colors.danger} />
            </View>
            <Text style={styles.doneTitle}>This trip ended</Text>
            <Text style={styles.doneBody}>
              {booking.cancellation_reason ?? 'It was cancelled before it could be completed.'}
            </Text>
            <View style={styles.doneActions}>
              <PrimaryButton
                label="Back to duty"
                onPress={() => router.replace('/home')}
                showArrow={false}
              />
            </View>
          </Animated.View>
        ) : null}
      </ScrollView>

      <CancelTripSheet
        visible={cancelling}
        bookingId={id}
        // Read at render, not captured when the sheet opened: the trip can move underneath it —
        // the poll may bring back ARRIVED while the driver is choosing a reason — and the penalty
        // is decided by the status the SERVER acts on, not the one that was showing a moment ago.
        status={booking.status}
        settings={settings.data?.settings}
        onClose={() => setCancelling(false)}
        onCancelled={(result) => {
          setCancelling(false);
          adopt(result.booking);
          /*
           * The penalty is a ledger row and the trip has left the driver's hands, so both of the
           * screens that show those are now stale. Invalidated rather than patched: what was
           * actually debited is the server's answer, in `result.fee`, and re-reading is how the
           * earnings screen stays the one place that number comes from.
           */
          void queryClient.invalidateQueries({ queryKey: keys.earnings.all() });
          void queryClient.invalidateQueries({ queryKey: keys.trip.list() });
        }}
      />
    </View>
  );
}

/**
 * The four-step rail.
 *
 * Its job is to answer "how much of this is left" at a glance, which a status word alone does not
 * — a driver on their third trip of the day reads the shape, not the sentence. The connector fills
 * with a spring rather than a jump so the advance is legible as movement even if you looked away
 * mid-transition.
 */
function Stepper({ status }: { status: BookingStatus }): ReactElement {
  const index = STEPS.findIndex((step) => step.status === status);
  // A terminal status is off the rail entirely; show it as fully walked rather than as step −1.
  const reached = index === -1 ? (TERMINAL.has(status) ? STEPS.length - 1 : 0) : index;

  return (
    <View style={styles.stepper}>
      {STEPS.map((step, i) => (
        <View key={step.status} style={styles.step}>
          <View style={styles.stepRow}>
            <StepDot done={i < reached} current={i === reached} />
            {i < STEPS.length - 1 ? <StepBar filled={i < reached} /> : null}
          </View>
          <Text style={[styles.stepLabel, i <= reached && styles.stepLabelOn]} numberOfLines={1}>
            {step.short}
          </Text>
        </View>
      ))}
    </View>
  );
}

function StepDot({ done, current }: { done: boolean; current: boolean }): ReactElement {
  const pulse = useSharedValue(0);

  useEffect(() => {
    // Only the CURRENT dot breathes. A rail where everything moves says nothing about where you are.
    pulse.value = withTiming(current ? 1 : 0, { duration: 260 });
  }, [current, pulse]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(1 + pulse.value * 0.18, { damping: 14, stiffness: 180 }) }],
  }));

  return (
    <Animated.View
      style={[styles.dot, (done || current) && styles.dotOn, current && styles.dotCurrent, style]}
    >
      {done ? <Feather name="check" size={11} color={colors.onFg} /> : null}
    </Animated.View>
  );
}

function StepBar({ filled }: { filled: boolean }): ReactElement {
  const style = useAnimatedStyle(() => ({
    backgroundColor: withTiming(filled ? colors.dutyOn : colors.border, { duration: 300 }),
  }));
  return <Animated.View style={[styles.stepBar, style]} />;
}

function StatusHeadline({ status }: { status: BookingStatus }): ReactElement {
  const copy = HEADLINES[status] ?? { title: 'Trip', body: '' };
  return (
    <Animated.View entering={FadeIn.duration(220)} style={styles.headline}>
      <Text style={styles.headlineTitle}>{copy.title}</Text>
      {copy.body === '' ? null : <Text style={styles.headlineBody}>{copy.body}</Text>}
    </Animated.View>
  );
}

/**
 * `Record<BookingStatus, …>` — exhaustive over the union, so a status added to contracts breaks
 * this file rather than rendering a trip with no words on it.
 */
const HEADLINES: Record<BookingStatus, { title: string; body: string }> = {
  PENDING_PAYMENT: { title: 'Waiting for payment', body: 'The customer has not paid yet.' },
  CONFIRMED: { title: 'Confirmed', body: 'Waiting to be assigned.' },
  SEARCHING: { title: 'Finding a driver', body: '' },
  ASSIGNED: { title: 'This trip is yours', body: 'Head to the pickup point when you are ready.' },
  DRIVER_EN_ROUTE: { title: 'On the way', body: 'Tell us when you reach the pickup point.' },
  ARRIVED: { title: 'At the pickup', body: 'Ask the customer for their 4-digit code.' },
  STARTED: { title: 'Trip in progress', body: 'Drive safely. End the trip when you arrive.' },
  COMPLETED: { title: 'Trip complete', body: '' },
  CANCELLED_BY_CUSTOMER: { title: 'Cancelled by the customer', body: '' },
  CANCELLED_BY_DRIVER: { title: 'You cancelled this trip', body: '' },
  CANCELLED_BY_ADMIN: { title: 'Cancelled by support', body: '' },
  NO_DRIVER_FOUND: { title: 'No driver was found', body: '' },
  EXPIRED: { title: 'This trip expired', body: '' },
};

function Waypoint({
  icon,
  label,
  address,
  active,
  onNavigate,
}: {
  icon: FeatherName;
  label: string;
  address: string;
  active: boolean;
  onNavigate: () => void;
}): ReactElement {
  return (
    <View style={styles.waypoint}>
      <View style={[styles.waypointIcon, active && styles.waypointIconActive]}>
        <Feather name={icon} size={15} color={active ? colors.dutyOn : colors.faint} />
      </View>

      <View style={styles.waypointText}>
        <Text style={styles.waypointLabel}>{label}</Text>
        <Text style={[styles.waypointAddress, !active && styles.waypointAddressIdle]} numberOfLines={2}>
          {address}
        </Text>
      </View>

      {/*
        Navigation is a HANDOFF to the maps app the driver already knows, not a map in here. They
        have their own routing preference and their own traffic data, and a half-built map would
        be the worst of both.
      */}
      <Pressable
        onPress={onNavigate}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Navigate to ${label}`}
        style={({ pressed }) => [styles.navButton, pressed && styles.navButtonPressed]}
      >
        <Feather name="navigation" size={17} color={colors.fg} />
      </Pressable>
    </View>
  );
}

function Meta({ icon, label, value }: { icon: FeatherName; label: string; value: string }): ReactElement {
  return (
    <View style={styles.meta}>
      <Feather name={icon} size={14} color={colors.muted} />
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

/**
 * Hand the coordinates to whatever the driver uses.
 *
 * `geo:` on Android is the intent every maps app registers for, so this respects a driver who has
 * chosen something other than Google Maps. The `?q=` label is what makes the pin readable once
 * they arrive in that app; the coordinates lead, so a wrongly-geocoded address name cannot send
 * them somewhere else.
 */
function openMaps(lat: number, lng: number, label: string): void {
  const url =
    Platform.OS === 'ios'
      ? `maps://?daddr=${lat},${lng}`
      : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
  void Linking.openURL(url).catch(() => {
    void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
  });
}

/** Metres under a kilometre, then one decimal. "1200 m" is harder to judge than "1.2 km". */
function formatDistance(metres: number): string {
  return metres < 1000 ? `${metres} m` : `${(metres / 1000).toFixed(1)} km`;
}

/**
 * Hand the number to the dialler — `tel:` opens the phone app with it entered, one tap from a
 * call. Not `ACTION_CALL`: placing the call itself would need the CALL_PHONE permission for a
 * saving of exactly one tap, and a misfire there is a call the driver did not mean to make.
 */
function callCustomer(phone: string): void {
  void Linking.openURL(`tel:${phone}`).catch(() => {
    /* No dialler (a tablet, mostly). Nothing useful to say — the number is on screen to read. */
  });
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
    backgroundColor: colors.bg,
  },
  centredTitle: { ...text.heading, color: colors.fg, marginTop: space.md, textAlign: 'center' },
  centredBody: { ...text.body, color: colors.muted, marginTop: space.xs, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSpacer: { width: 24 },

  scroll: { padding: space.lg, paddingBottom: space.xl },

  stepper: { flexDirection: 'row', marginBottom: space.lg },
  step: { flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotOn: { backgroundColor: colors.dutyOn, borderColor: colors.dutyOn },
  dotCurrent: { backgroundColor: colors.bg, borderColor: colors.dutyOn, borderWidth: 3 },
  stepBar: { flex: 1, height: 3, marginHorizontal: 4, borderRadius: 2 },
  stepLabel: { ...text.caption, color: colors.faint, marginTop: space.xs },
  stepLabelOn: { color: colors.fg, fontWeight: '600' },

  headline: { marginBottom: space.md },
  headlineTitle: { ...text.title, color: colors.fg },
  headlineBody: { ...text.body, color: colors.muted, marginTop: 2 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    ...shadow.soft,
  },
  waypoint: { flexDirection: 'row', alignItems: 'center' },
  waypointIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waypointIconActive: { backgroundColor: colors.dutyOnBg },
  waypointText: { flex: 1, marginHorizontal: space.sm },
  waypointLabel: {
    ...text.caption,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  waypointAddress: { ...text.body, color: colors.fg, fontWeight: '600' },
  waypointAddressIdle: { fontWeight: '400', color: colors.muted },
  waypointRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.sm,
    marginLeft: 44,
  },
  navButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonPressed: { backgroundColor: colors.bgSunken },

  metaRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  meta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
  },
  metaLabel: { ...text.caption, color: colors.muted, marginLeft: 6, flex: 1 },
  metaValue: { ...text.label, color: colors.fg },

  cashNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF6E0',
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.md,
  },
  cashNoteText: { ...text.caption, color: colors.fg, marginLeft: space.xs, flex: 1 },

  riderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginTop: space.md,
    ...shadow.soft,
  },
  riderAvatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  riderText: { flex: 1, marginHorizontal: space.sm },
  riderLabel: {
    ...text.caption,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  riderName: { ...text.body, color: colors.fg, fontWeight: '600' },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.dutyOn,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  callButtonPressed: { opacity: 0.85 },
  callButtonText: { ...text.label, color: colors.onFg, fontWeight: '700' },

  error: { ...text.body, color: colors.danger, marginTop: space.md },

  actions: { marginTop: space.lg },

  cancelWrap: { alignItems: 'center', marginTop: space.xl },
  cancelAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  cancelActionPressed: { backgroundColor: '#FDEEF0' },
  cancelLabel: { ...text.label, color: colors.danger },

  gate: {
    marginTop: space.md,
    backgroundColor: '#FDEEF0',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: space.md,
  },
  gateTitle: { ...text.label, color: colors.danger },
  gateBody: { ...text.caption, color: colors.fg, marginTop: 2 },
  gateAction: {
    marginTop: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: 'center',
  },
  gateActionLabel: { ...text.label, color: colors.fg },
  gateDone: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  gateDoneText: { ...text.caption, color: colors.fg, marginLeft: 6, flex: 1 },

  otpTitle: { ...text.heading, color: colors.fg },
  otpBody: { ...text.body, color: colors.muted, marginTop: 2 },
  otpBox: { marginTop: space.md, alignItems: 'center' },
  otpCells: { width: 248 },
  otpPending: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: space.md },
  otpPendingText: { ...text.body, color: colors.muted, marginLeft: space.sm },

  done: { alignItems: 'center', marginTop: space.lg },
  doneIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.dutyOnBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneIconEnded: { backgroundColor: '#FDEEF0' },
  doneTitle: { ...text.title, color: colors.fg, marginTop: space.md },
  doneBody: { ...text.body, color: colors.muted, marginTop: space.xs, textAlign: 'center' },
  rateBlock: { alignSelf: 'stretch' },
  doneActions: { alignSelf: 'stretch', marginTop: space.lg },

  retry: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
  },
  retryLabel: { ...text.label, color: colors.brandOnFg },
  textAction: { marginTop: space.md, padding: space.sm, alignItems: 'center' },
  textActionLabel: { ...text.body, color: colors.link },
});
