import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentProps, type ReactElement, type ReactNode } from 'react';
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
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { BookingDto, BookingStatus } from '@driverzone/contracts';
import {
  formatPaise,
  initialsOf,
  toTripStatus,
  tripTotalPaise,
  type TripStatus,
} from '@/features/trips/tripHistory';
import { AppIcon } from '@/components/AppIcon';
import { getTrip } from '@/lib/api/endpoints/trip';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * ONE TRIP, AFTER THE FACT — the receipt, not the job.
 *
 * **Deliberately a different route from `app/trip/[id].tsx`, which is the LIVE trip.** That screen
 * is a state machine with an action at every step and a poll driving it; this one has no actions,
 * asks once, and never polls. Reusing one screen for both would mean a finished trip carrying the
 * machinery of a running one — a slide-to-end control one render away from a trip that ended last
 * Tuesday.
 *
 * **A live trip is handed back to the screen that can act on it.** Opening a row that is still
 * running from the Trips tab routes to `/trip/[id]` instead of rendering a read-only copy of a job
 * the driver is supposed to be doing.
 *
 * **Every number is the server's own.** The fare lines, the adjustments and the total come off
 * `BookingDto`; what the DRIVER earned from this trip is a commission split this DTO does not
 * carry, and the honest place for it is Earnings, which reads the ledger. This screen says so
 * rather than deriving a share nobody could check against a payout.
 */

const STATUS_COPY: Record<TripStatus, { label: string; color: string; tint: string }> = {
  COMPLETED: { label: 'Completed', color: colors.dutyOn, tint: colors.dutyOnBg },
  CANCELLED: { label: 'Cancelled', color: colors.danger, tint: '#FDEEF0' },
  RUNNING: { label: 'In progress', color: colors.link, tint: '#EAF1FD' },
};

/** `Record<BookingStatus, …>` — exhaustive, so a status added to contracts breaks this file. */
const HEADLINE: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'Waiting for payment',
  CONFIRMED: 'Confirmed',
  SEARCHING: 'Finding a driver',
  WAITING_DRIVER: 'Waiting for a driver',
  ASSIGNED: 'Accepted',
  DRIVER_EN_ROUTE: 'On the way',
  ARRIVED: 'At the pickup',
  STARTED: 'Trip in progress',
  COMPLETED: 'Trip complete',
  CANCELLED_BY_CUSTOMER: 'Cancelled by the customer',
  CANCELLED_BY_DRIVER: 'You cancelled this trip',
  CANCELLED_BY_ADMIN: 'Cancelled by support',
  NO_DRIVER_FOUND: 'No driver was found',
  EXPIRED: 'This trip expired',
};

export default function TripReceiptScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();

  /*
   * ASKED ONCE. A finished trip does not change, so there is no interval here and no
   * `refetchOnMount` churn — the list this was opened from is the thing that refreshes, on focus.
   */
  const trip = useQuery({
    queryKey: keys.trip.detail(id),
    queryFn: ({ signal }) => getTrip(id, signal),
  });

  const booking = trip.data ?? null;

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
        <Pressable
          onPress={() => void trip.refetch()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          style={styles.textAction}
        >
          <Text style={styles.textActionLabel}>Back to trips</Text>
        </Pressable>
      </View>
    );
  }

  const status = toTripStatus(booking.status);
  const copy = STATUS_COPY[status];
  const cash = booking.payment_mode === 'CASH';
  const totalPaise = tripTotalPaise(booking);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to trips"
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {booking.reference}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {HEADLINE[booking.status]}
          </Text>
        </View>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── The headline: what it came to, and how it ended ───────────────────────────── */}
        <Stagger index={0}>
          <View style={styles.hero}>
            <View style={[styles.heroPill, { backgroundColor: copy.tint }]}>
              <Text style={[styles.heroPillLabel, { color: copy.color }]}>{copy.label}</Text>
            </View>
            <Text style={styles.heroAmount}>{formatPaise(totalPaise)}</Text>
            <Text style={styles.heroCaption}>
              {status === 'COMPLETED'
                ? 'Trip fare. Your share is in Earnings.'
                : status === 'CANCELLED'
                  ? 'This trip did not run.'
                  : 'Fare so far.'}
            </Text>

            {/*
              A live trip belongs on the screen that can act on it. Offered rather than routed
              automatically: a driver who tapped a row expects to land where they aimed, and being
              thrown into a slide-to-end control they did not ask for is how a trip gets finished
              by accident.
            */}
            {status === 'RUNNING' ? (
              <Pressable
                onPress={() => router.replace(`/trip/${booking.id}`)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.heroAction, pressed && styles.pressed]}
              >
                <Feather name="navigation" size={15} color={colors.fg} />
                <Text style={styles.heroActionLabel}>Open live trip</Text>
              </Pressable>
            ) : null}
          </View>
        </Stagger>

        {/* ── Customer ──────────────────────────────────────────────────────────────────── */}
        <Stagger index={1}>
          <Section title="Customer">
            <View style={styles.customerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialsOf(booking.customer?.name ?? null)}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.customerName} numberOfLines={1}>
                  {booking.customer?.name ?? 'Customer'}
                </Text>
                {/*
                  NO PHONE NUMBER, and that is the API's answer rather than a gap this screen is
                  covering: nothing in the driver's view of a booking carries one. A driver needing
                  to reach a past customer goes through support, which is what keeps a finished
                  trip from being a permanent line to somebody's handset.
                */}
                <Text style={styles.customerSub}>
                  {booking.customer?.name === null || booking.customer === null
                    ? 'No name on this account'
                    : 'Rode with you on this trip'}
                </Text>
              </View>
            </View>
          </Section>
        </Stagger>

        {/* ── Route ─────────────────────────────────────────────────────────────────────── */}
        <Stagger index={2}>
          <Section title="Route">
            <Waypoint
              icon="map-pin"
              label="Pick up"
              address={booking.pickup.address}
              tone="pickup"
              onNavigate={() =>
                openMaps(booking.pickup.lat, booking.pickup.lng, booking.pickup.address)
              }
            />
            <View style={styles.waypointRule} />
            <Waypoint
              icon="flag"
              label="Drop"
              address={booking.drop.address}
              tone="drop"
              onNavigate={() => openMaps(booking.drop.lat, booking.drop.lng, booking.drop.address)}
            />
          </Section>
        </Stagger>

        {/* ── Payment ───────────────────────────────────────────────────────────────────── */}
        <Stagger index={3}>
          <Section title="Payment">
            <View style={[styles.payBanner, cash ? styles.payBannerCash : styles.payBannerPrepaid]}>
              <View style={styles.payBannerIcon}>
                <AppIcon
                  name={cash ? 'rupee' : 'smartphone'}
                  size={16}
                  color={cash ? colors.warning : colors.dutyOn}
                />
              </View>
              <View style={styles.flex}>
                <Text style={styles.payBannerTitle}>{cash ? 'Cash' : 'Prepaid (UPI)'}</Text>
                <Text style={styles.payBannerBody}>
                  {cash
                    ? 'Collected from the customer at the end of the trip.'
                    : 'Paid online before the trip. Nothing to collect.'}
                </Text>
              </View>
            </View>

            {booking.fare.lines.map((line) => (
              <MoneyRow key={line.code} label={line.label} value={line.amount.amount_display} />
            ))}

            {/*
              ADJUSTMENTS STAY SEPARATE from the fare lines above, never merged. The fare is what
              the customer agreed to and is immutable (invariant B-1); an adjustment is what
              happened afterwards — a receipt that blends them cannot explain which was which.
            */}
            {booking.adjustments.map((adjustment, index) => (
              <MoneyRow
                key={`${adjustment.type}_${String(index)}`}
                label={adjustment.label}
                value={adjustment.amount.amount_display}
                muted
              />
            ))}

            <View style={styles.rule} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Trip total</Text>
              <Text style={styles.totalValue}>{formatPaise(totalPaise)}</Text>
            </View>

            <Pressable
              onPress={() => router.replace('/earnings')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.earningsLink, pressed && styles.pressed]}
            >
              <Feather name="trending-up" size={14} color={colors.link} />
              <Text style={styles.earningsLinkLabel}>See what you earned in Earnings</Text>
              <Feather name="chevron-right" size={15} color={colors.link} />
            </Pressable>
          </Section>
        </Stagger>

        {/* ── Timeline ──────────────────────────────────────────────────────────────────── */}
        <Stagger index={4}>
          <Section title="Timeline">
            <Timeline booking={booking} />
          </Section>
        </Stagger>

        {booking.cancellation_reason === null ? null : (
          <Stagger index={5}>
            <View style={styles.reasonCard}>
              <Feather name="x-circle" size={16} color={colors.danger} />
              <View style={styles.flex}>
                <Text style={styles.reasonTitle}>Why it was cancelled</Text>
                <Text style={styles.reasonBody}>{booking.cancellation_reason}</Text>
              </View>
            </View>
          </Stagger>
        )}
      </ScrollView>
    </View>
  );
}

/** A staggered rise on first paint, in reading order — the same motion the trip screen uses. */
function Stagger({ index, children }: { index: number; children: ReactNode }): ReactElement {
  return (
    <Animated.View entering={FadeInDown.delay(index * 55).duration(220)}>{children}</Animated.View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Waypoint({
  icon,
  label,
  address,
  tone,
  onNavigate,
}: {
  icon: FeatherName;
  label: string;
  address: string;
  tone: 'pickup' | 'drop';
  onNavigate: () => void;
}): ReactElement {
  return (
    <View style={styles.waypoint}>
      <View style={[styles.waypointIcon, tone === 'pickup' ? styles.iconPickup : styles.iconDrop]}>
        <Feather
          name={icon}
          size={14}
          color={tone === 'pickup' ? colors.dutyOn : colors.danger}
        />
      </View>
      <View style={styles.flex}>
        <Text style={styles.waypointLabel}>{label}</Text>
        <Text style={styles.waypointAddress}>{address}</Text>
      </View>
      {/*
        Still useful on a finished trip: "where was that place?" is a real question a driver asks
        about a route they might get again. A handoff to their own maps app, never a map in here.
      */}
      <Pressable
        onPress={onNavigate}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Open ${label} in maps`}
        style={({ pressed }) => [styles.navButton, pressed && styles.pressed]}
      >
        <Feather name="external-link" size={15} color={colors.fg} />
      </Pressable>
    </View>
  );
}

function MoneyRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}): ReactElement {
  return (
    <View style={styles.moneyRow}>
      <Text style={[styles.moneyLabel, muted && styles.moneyLabelMuted]} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.moneyValue}>{value}</Text>
    </View>
  );
}

/**
 * The stages that actually happened, in the order the state machine allows them.
 *
 * Only REACHED milestones are drawn. On a live trip the customer's own screen shows what is still
 * pending, because they are waiting for it; a driver reading a finished trip is reading a record,
 * and a row saying "Pending" on a trip that ended two weeks ago is noise.
 */
function Timeline({ booking }: { booking: BookingDto }): ReactElement {
  const { timestamps } = booking;

  const milestones = [
    { key: 'assigned', label: 'You accepted', at: timestamps.assigned_at },
    { key: 'en_route', label: 'Set off to pickup', at: timestamps.en_route_at },
    { key: 'arrived', label: 'Reached the pickup', at: timestamps.arrived_at },
    { key: 'started', label: 'Trip started', at: timestamps.started_at },
    { key: 'completed', label: 'Trip completed', at: timestamps.completed_at },
    { key: 'cancelled', label: 'Cancelled', at: timestamps.cancelled_at },
  ].filter((milestone): milestone is { key: string; label: string; at: string } =>
    milestone.at !== null,
  );

  if (milestones.length === 0) {
    return <Text style={styles.timelineEmpty}>Nothing was recorded for this trip.</Text>;
  }

  return (
    <View>
      {milestones.map((milestone, index) => {
        const bad = milestone.key === 'cancelled';
        return (
          <View key={milestone.key} style={styles.timelineRow}>
            <View style={styles.timelineMarkers}>
              <View style={[styles.timelineDot, bad && styles.timelineDotBad]}>
                <Feather
                  name={bad ? 'x' : 'check'}
                  size={10}
                  color={bad ? colors.card : colors.onFg}
                />
              </View>
              {index < milestones.length - 1 ? <View style={styles.timelineLine} /> : null}
            </View>
            <View style={styles.timelineText}>
              <Text style={[styles.timelineLabel, bad && styles.timelineLabelBad]}>
                {milestone.label}
              </Text>
              <Text style={styles.timelineTime}>{formatStamp(milestone.at)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatStamp(iso: string): string {
  const at = new Date(iso);
  return `${at.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
  })}, ${at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * Hand the coordinates to whatever the driver uses — the same helper the live trip screen carries,
 * for the same reason: they have their own routing preference and their own traffic data.
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },

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
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    ...shadow.card,
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSubtitle: { ...text.caption, color: colors.fg, opacity: 0.7, marginTop: 1 },

  scroll: { padding: space.lg, paddingBottom: space.xl },

  hero: {
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  heroPill: { paddingHorizontal: space.md, paddingVertical: 4, borderRadius: radius.pill },
  heroPillLabel: { ...text.caption, fontFamily: fontFamily.semibold },
  heroAmount: {
    fontSize: 38,
    lineHeight: 46,
    fontFamily: fontFamily.bold,
    fontWeight: '800',
    color: colors.fg,
    marginTop: space.sm,
  },
  heroCaption: { ...text.caption, color: colors.muted, textAlign: 'center' },
  heroAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  heroActionLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.soft,
  },
  cardTitle: {
    ...text.caption,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: space.md,
  },

  customerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  avatarText: { ...text.heading, color: colors.fg },
  customerName: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  customerSub: { ...text.caption, color: colors.muted, marginTop: 1 },

  waypoint: { flexDirection: 'row', alignItems: 'center' },
  waypointIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  iconPickup: { backgroundColor: colors.dutyOnBg },
  iconDrop: { backgroundColor: '#FDEEF0' },
  waypointLabel: {
    ...text.caption,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  waypointAddress: { ...text.body, color: colors.fg },
  waypointRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.sm,
    marginLeft: 40,
  },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  payBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.md,
  },
  payBannerCash: { backgroundColor: '#FFF6E0' },
  payBannerPrepaid: { backgroundColor: colors.dutyOnBg },
  payBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  payBannerTitle: { ...text.label, color: colors.fg },
  payBannerBody: { ...text.caption, color: colors.muted, marginTop: 1 },

  moneyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.xs,
  },
  moneyLabel: { ...text.body, color: colors.fg, flex: 1 },
  moneyLabelMuted: { color: colors.muted },
  moneyValue: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  totalValue: { ...text.heading, color: colors.fg },

  earningsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  earningsLinkLabel: { ...text.caption, color: colors.link, flex: 1 },

  timelineRow: { flexDirection: 'row' },
  timelineMarkers: { alignItems: 'center', width: 22 },
  timelineDot: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.dutyOn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotBad: { backgroundColor: colors.danger },
  timelineLine: { width: 2, flex: 1, minHeight: 18, backgroundColor: colors.border },
  timelineText: { flex: 1, paddingBottom: space.md, paddingLeft: space.sm },
  timelineLabel: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  timelineLabelBad: { color: colors.danger },
  timelineTime: { ...text.caption, color: colors.faint, marginTop: 1 },
  timelineEmpty: { ...text.body, color: colors.muted },

  reasonCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: '#FDEEF0',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: space.md,
  },
  reasonTitle: { ...text.label, color: colors.danger },
  reasonBody: { ...text.caption, color: colors.fg, marginTop: 2 },

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
