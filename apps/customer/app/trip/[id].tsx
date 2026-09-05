import { Feather } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { BookingDto, BookingStatus, CancelBookingResponse } from '@driverzone/contracts';
import { CancelBookingSheet } from '@/components/CancelBookingSheet';
import { DriverCard } from '@/components/DriverCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatTime } from '@/features/booking/schedule';
import {
  hasDriverAssigned,
  isCustomerCancellable,
  isLiveStatus,
  isTerminalStatus,
  showsStartOtp,
  tripStatusCopy,
} from '@/features/booking/status';
import { getBooking } from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * The trip's own screen — reached from Confirm, and a ROUTE rather than a sheet.
 *
 * Every other booking surface in this app is a sheet over the map, deliberately, but a trip in
 * progress outlives that interaction: the customer backgrounds the app, gets a call, comes back
 * twenty minutes later expecting to see where things stand. A sheet lives inside `home.tsx`'s own
 * state and is gone the moment that screen unmounts; a route survives exactly the way the OS
 * itself expects a screen to.
 *
 * POLLS, does not push. Nothing server-side notifies this screen — there is no socket wired up
 * for the customer app yet — so `GET /customer/bookings/:id` is asked again on an interval, and
 * the interval stops itself once the trip reaches a status nothing follows.
 *
 * EVERY NUMBER HERE IS THE SERVER'S OWN. That once ruled out the driver card entirely — the DTO
 * carried an id and a name and nothing else. It now carries the photo, the rating and, WHILE THE
 * TRIP IS LIVE, the driver's phone number, so `DriverCard` renders all three and offers a call.
 *
 * The rule that replaced the old note is the server's, not this screen's: `driver.phone` is null
 * on a finished trip, so the call button disappears on its own when the trip ends. There is still
 * no vehicle list, because there is still nothing behind it to show.
 */
export default function TripScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const booking = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: () => getBooking(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isTerminalStatus(status) ? false : 4000;
    },
  });

  const [cancelling, setCancelling] = useState(false);
  const [lastCancel, setLastCancel] = useState<CancelBookingResponse | null>(null);

  const data = booking.data;
  const copy = data === undefined ? null : tripStatusCopy(data.status);

  /*
   * THE RATE-YOUR-DRIVER HANDOFF, and ONLY on a transition witnessed in this session. `previous`
   * starts `undefined` and is set on every render that has data — so a customer who opens an
   * already-COMPLETED booking cold (from a fresh app launch, say) never gets shoved into rating a
   * trip they may have already rated or skipped. It fires exactly once: the poll that first
   * observes STARTED → COMPLETED while this screen happens to be open and watching.
   */
  const previousStatus = useRef<BookingStatus | undefined>(undefined);
  useEffect(() => {
    if (data === undefined) return;
    if (
      previousStatus.current !== undefined &&
      previousStatus.current !== 'COMPLETED' &&
      data.status === 'COMPLETED'
    ) {
      router.replace(`/rate/${id}`);
    }
    previousStatus.current = data.status;
  }, [data, id]);

  return (
    <View style={styles.root}>
      {/*
        THE YELLOW BAND is the one piece of chrome this screen borrows from the reference design —
        everything under it is rebuilt from what `BookingDto` actually carries.
      */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace('/home')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {data?.reference ?? 'Your trip'}
          </Text>
          {copy === null ? null : (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {copy.title}
            </Text>
          )}
        </View>
        <View style={styles.back} />
      </View>

      {booking.isPending ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : booking.isError ? (
        <View style={styles.centre}>
          <Text style={styles.loadError}>We could not load this trip.</Text>
          <Pressable
            onPress={() => void booking.refetch()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Feather name="refresh-cw" size={15} color={colors.fg} />
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : data === undefined || copy === null ? null : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {lastCancel === null ? null : (
              <Animated.View entering={FadeIn.duration(180)} style={styles.cancelResult}>
                <Feather name="check-circle" size={16} color={colors.fg} style={styles.rowIcon} />
                <Text style={styles.cancelResultText}>
                  Trip cancelled.{' '}
                  {lastCancel.fee.amount_paise > 0
                    ? `A ${lastCancel.fee.amount_display} cancellation fee applies.`
                    : 'No fee was charged.'}
                </Text>
              </Animated.View>
            )}

            <Stagger index={0}>
              <StatusCard booking={data} />
            </Stagger>

            {showsStartOtp(data.status) && data.start_otp !== null ? (
              <Stagger index={1}>
                <View style={styles.otpCard}>
                  <Text style={styles.otpLabel}>Your trip code</Text>
                  <OtpDigits code={data.start_otp} />
                  <Text style={styles.otpHint}>Read this to your driver to start the ride.</Text>
                </View>
              </Stagger>
            ) : null}

            {data.driver === null ? null : (
              <Stagger index={2}>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Your driver</Text>
                  <DriverCard driver={data.driver} />
                </View>
              </Stagger>
            )}

            <Stagger index={3}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Booking details</Text>
                <DetailRow
                  icon="package"
                  label="Package"
                  value={data.fare.lines[0]?.label ?? data.service_type}
                />
                <DetailRow icon="map-pin" label="Pickup" value={data.pickup.address} />
                <DetailRow icon="flag" label="Destination" value={data.drop.address} last />
              </View>
            </Stagger>

            <Stagger index={4}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Trip progress</Text>
                <ProgressTimeline booking={data} />
              </View>
            </Stagger>

            <Stagger index={5}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Fare</Text>
                {data.fare.lines.map((line) => (
                  <DetailRow
                    key={line.code}
                    label={line.label}
                    value={line.amount.amount_display}
                    plain
                  />
                ))}
                {data.adjustments.map((adjustment, index) => (
                  <DetailRow
                    key={`${adjustment.type}_${String(index)}`}
                    label={adjustment.label}
                    value={adjustment.amount.amount_display}
                    plain
                  />
                ))}
                <View style={styles.rule} />
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total</Text>
                  <Text style={styles.totalValue}>{data.fare.total.amount_display}</Text>
                </View>
                {data.payment_mode === 'CASH' ? (
                  <Text style={styles.cashNote}>
                    Pay the driver in cash at the end of your trip.
                  </Text>
                ) : null}
              </View>
            </Stagger>
          </ScrollView>

          {isCustomerCancellable(data.status) ? (
            <Pressable
              onPress={() => setCancelling(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancelBar, pressed && styles.cancelBarPressed]}
            >
              <View>
                <Text style={styles.cancelBarLabel}>Cancel trip</Text>
                <Text style={styles.cancelBarHint}>Need to cancel this trip?</Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.brand} />
            </Pressable>
          ) : isTerminalStatus(data.status) ? (
            <View style={styles.doneWrap}>
              <PrimaryButton
                label="Done"
                onPress={() => router.replace('/home')}
                showArrow={false}
              />
            </View>
          ) : null}
        </>
      )}

      <CancelBookingSheet
        visible={cancelling}
        bookingId={id}
        driverAssigned={data !== undefined && hasDriverAssigned(data.status)}
        onClose={() => setCancelling(false)}
        onCancelled={(result) => {
          setCancelling(false);
          setLastCancel(result);
          queryClient.setQueryData(keys.bookings.detail(id), result.booking);
        }}
      />
    </View>
  );
}

/** A staggered rise on first paint — every card on this screen uses it, in reading order. */
function Stagger({ index, children }: { index: number; children: ReactNode }): ReactElement {
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(220)}>{children}</Animated.View>
  );
}

/**
 * The trip code, as four boxes rather than one letter-spaced string — the same visual language
 * `OtpInput` uses to COLLECT a code at login, reused here to DISPLAY one. Read-only: there is
 * nothing to type, this is what the customer reads aloud.
 */
function OtpDigits({ code }: { code: string }): ReactElement {
  return (
    <View style={styles.otpRow}>
      {code.split('').map((digit, index) => (
        // eslint-disable-next-line react/no-array-index-key -- a fixed 4-digit code has no stable identity per cell besides position
        <View key={index} style={styles.otpCell}>
          <Text style={styles.otpDigit}>{digit}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusCard({ booking }: { booking: BookingDto }): ReactElement {
  const copy = tripStatusCopy(booking.status);

  /*
   * "INCLUDED UNTIL", NOT "ESTIMATED COMPLETION" — there is no overage in this product any more
   * (`computeIncityFare`'s own doc: the quoted total IS the total), so a trip running past this
   * instant costs nothing extra and may perfectly well still be going. Calling it a completion
   * estimate would claim a forecast this app has no basis for; this is the one fact that IS
   * exact — the minute the included time runs out — read straight off `startedAt +
   * includedMinutes`, both of which are real, stored values.
   */
  const includedUntil =
    booking.status === 'STARTED' &&
    booking.included_minutes !== null &&
    booking.timestamps.started_at !== null
      ? new Date(
          new Date(booking.timestamps.started_at).getTime() + booking.included_minutes * 60_000,
        )
      : null;

  return (
    <View style={styles.statusCard}>
      <View style={styles.statusRow}>
        <StatusIcon icon={copy.icon} live={isLiveStatus(booking.status)} />
        <View style={styles.flex}>
          <Text style={styles.statusLabel}>Current status</Text>
          <Text style={styles.statusTitle}>{copy.title}</Text>
          {copy.body.length === 0 ? null : <Text style={styles.statusBody}>{copy.body}</Text>}
        </View>
      </View>

      {includedUntil === null ? null : (
        <View style={styles.statusStat}>
          <View style={styles.statusStatIcon}>
            <Feather name="clock" size={13} color={colors.muted} />
          </View>
          <View>
            <Text style={styles.statusStatLabel}>Included until</Text>
            <Text style={styles.statusStatValue}>{formatTime(includedUntil)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * A soft pulsing ring behind the icon while something is actually IN MOTION — a still icon next
 * to "Finding your driver" reads as the app having stalled, the way a spinner-less loading screen
 * always does. Held perfectly still for a terminal status, where nothing is happening any more
 * and a pulse would be a lie about that.
 */
function StatusIcon({ icon, live }: { icon: FeatherName; live: boolean }): ReactElement {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (live) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      pulse.value = 0;
    }
  }, [live, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: live ? 0.35 * (1 - pulse.value) : 0,
    transform: [{ scale: 1 + pulse.value * 0.45 }],
  }));

  return (
    <View style={styles.statusIconWrap}>
      <Animated.View style={[styles.statusIconRing, ringStyle]} />
      <View style={styles.statusIcon}>
        <Feather name={icon} size={22} color={colors.fg} />
      </View>
    </View>
  );
}

interface Milestone {
  key: string;
  label: string;
  at: string | null;
}

/**
 * The real stages, in the order the state machine actually allows them (`booking.entity.ts`'s
 * `TRANSITIONS`). Every timestamp here is one `BookingDto.timestamps` already carries — nothing
 * is estimated or interpolated between two real points.
 */
function ProgressTimeline({ booking }: { booking: BookingDto }): ReactElement {
  const { timestamps, status } = booking;

  const cancelledOrExpired =
    timestamps.cancelled_at !== null || status === 'NO_DRIVER_FOUND' || status === 'EXPIRED';

  const milestones: Milestone[] = [
    { key: 'assigned', label: 'Driver assigned', at: timestamps.assigned_at },
    { key: 'en_route', label: 'Driver on the way', at: timestamps.en_route_at },
    { key: 'arrived', label: 'Driver arrived', at: timestamps.arrived_at },
    { key: 'started', label: 'Trip started', at: timestamps.started_at },
    ...(cancelledOrExpired
      ? []
      : [{ key: 'completed', label: 'Trip complete', at: timestamps.completed_at }]),
  ];

  /*
   * THREE STATES, NOT TWO. A step neither reached yet nor merely "someday" — it is what happens
   * NEXT — is real information this booking's own status already answers, not a guess: it is the
   * first unreached milestone, and only while the trip is still live at all. A pending step on a
   * dead-ended booking (NO_DRIVER_FOUND, EXPIRED) has no "next" to be, which is exactly what
   * `cancelledOrExpired` already tracks for the row below.
   */
  const currentIndex = cancelledOrExpired
    ? -1
    : milestones.findIndex((milestone) => milestone.at === null);

  return (
    <View>
      {milestones.map((milestone, index) => {
        const reached = milestone.at !== null;
        const isCurrent = !reached && index === currentIndex;
        const isLast = index === milestones.length - 1 && !cancelledOrExpired;
        return (
          <View key={milestone.key} style={styles.timelineRow}>
            <View style={styles.timelineMarkerCol}>
              <View
                style={[
                  styles.timelineDot,
                  reached && styles.timelineDotDone,
                  isCurrent && styles.timelineDotCurrent,
                ]}
              >
                {reached ? <Feather name="check" size={11} color={colors.brandOnFg} /> : null}
              </View>
              {isLast ? null : (
                <View style={[styles.timelineLine, reached && styles.timelineLineDone]} />
              )}
            </View>
            <View style={styles.timelineText}>
              <Text
                style={[styles.timelineLabel, (reached || isCurrent) && styles.timelineLabelDone]}
              >
                {milestone.label}
              </Text>
              <Text style={[styles.timelineTime, isCurrent && styles.timelineTimeCurrent]}>
                {milestone.at !== null
                  ? formatTime(new Date(milestone.at))
                  : isCurrent
                    ? 'Next up'
                    : 'Pending'}
              </Text>
            </View>
          </View>
        );
      })}

      {cancelledOrExpired ? (
        <View style={styles.timelineRow}>
          <View style={styles.timelineMarkerCol}>
            <View style={[styles.timelineDot, styles.timelineDotBad]}>
              <Feather name="x" size={11} color={colors.card} />
            </View>
          </View>
          <View style={styles.timelineText}>
            <Text style={[styles.timelineLabel, styles.timelineLabelBad]}>
              {tripStatusCopy(status).title}
            </Text>
            <Text style={styles.timelineTime}>
              {timestamps.cancelled_at === null
                ? '—'
                : formatTime(new Date(timestamps.cancelled_at))}
            </Text>
            {booking.cancellation_reason === null ? null : (
              <Text style={styles.timelineReason}>{booking.cancellation_reason}</Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  last = false,
  plain = false,
}: {
  icon?: FeatherName;
  label: string;
  value: string;
  last?: boolean;
  plain?: boolean;
}): ReactElement {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      {icon === undefined || plain ? (
        <View style={styles.detailIconSlot} />
      ) : (
        <View style={styles.detailIconBubble}>
          <Feather name={icon} size={13} color={colors.fg} />
        </View>
      )}
      <Text style={[styles.detailLabel, plain && styles.detailLabelPlain]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    // Lifts it off the scroll content beneath, the same way `card` lifts off `bg` — without
    // this the rounded corners just sit flush and read as a colour change, not a surface.
    ...shadow.card,
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSubtitle: { ...text.caption, color: colors.fg, opacity: 0.7, marginTop: 1 },

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

  content: { padding: space.lg, paddingBottom: space.xl },

  cancelResult: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.md,
  },
  cancelResultText: { ...text.caption, color: colors.fg, flex: 1 },
  rowIcon: { marginRight: space.sm, marginTop: 1 },

  statusCard: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusIconWrap: {
    width: 48,
    height: 48,
    marginRight: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  statusLabel: { ...text.caption, color: colors.muted },
  statusTitle: { ...text.heading, color: colors.fg, marginTop: 1 },
  statusBody: { ...text.caption, color: colors.muted, marginTop: 2 },
  statusStat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statusStatIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  statusStatLabel: { ...text.caption, color: colors.muted },
  statusStatValue: {
    ...text.label,
    color: colors.fg,
    fontFamily: fontFamily.semibold,
    marginTop: 1,
  },

  otpCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  otpLabel: { ...text.label, color: colors.muted, marginBottom: space.sm },
  otpRow: { flexDirection: 'row', gap: space.sm },
  otpCell: {
    width: 44,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: { fontSize: 22, fontFamily: fontFamily.bold, color: colors.fg },
  otpHint: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.sm },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.soft,
  },
  cardTitle: { ...text.label, color: colors.fg, marginBottom: space.sm },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailIconSlot: { width: 26, marginRight: space.sm },
  detailIconBubble: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  detailLabel: { ...text.caption, color: colors.muted, width: 80 },
  detailLabelPlain: { color: colors.muted },
  detailValue: { ...text.body, color: colors.fg, flex: 1, textAlign: 'right' },

  timelineRow: { flexDirection: 'row' },
  timelineMarkerCol: { alignItems: 'center', width: 24 },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotDone: { backgroundColor: colors.fg, borderColor: colors.fg },
  // Yellow, not ink — a THIRD colour for a third state. Reusing the "done" fill for "next up"
  // would say a step already happened; reusing the pending grey would erase the distinction this
  // whole block exists to draw.
  timelineDotCurrent: { backgroundColor: colors.brand, borderColor: colors.brand },
  timelineDotBad: { backgroundColor: colors.danger, borderColor: colors.danger },
  timelineLine: { width: 2, flex: 1, minHeight: 22, backgroundColor: colors.border },
  timelineLineDone: { backgroundColor: colors.fg },
  timelineText: { flex: 1, paddingBottom: space.md, paddingLeft: space.sm },
  timelineLabel: { ...text.body, color: colors.faint },
  timelineLabelDone: { color: colors.fg, fontFamily: fontFamily.semibold },
  timelineLabelBad: { color: colors.danger, fontFamily: fontFamily.semibold },
  timelineTime: { ...text.caption, color: colors.faint, marginTop: 1 },
  timelineTimeCurrent: { color: colors.fg, fontFamily: fontFamily.semibold },
  timelineReason: { ...text.caption, color: colors.muted, marginTop: 2 },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  totalValue: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  cashNote: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.md },

  cancelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.fg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  cancelBarPressed: { opacity: 0.85 },
  cancelBarLabel: { ...text.label, color: colors.brand, fontFamily: fontFamily.bold },
  cancelBarHint: { ...text.caption, color: colors.onFg, opacity: 0.7, marginTop: 1 },

  doneWrap: { padding: space.lg },
});
