import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CAR_CATEGORY_LABELS, VEHICLE_TYPE_LABELS, type BookingDto } from '@driverzone/contracts';
import { rideHappenedAt, toRideStatus, type RideStatus } from '@/features/rides/rideHistory';
import { DriverCard } from '@/components/DriverCard';
import { FareBreakdown, fareBreakdownRows, paidViaLabel } from '@/components/FareBreakdown';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatDuration } from '@/features/booking/schedule';
import { rebookParamsFor } from '@/features/booking/rebook';
import { getBooking } from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * Ride detail — one past booking, read from the API.
 *
 * WAS ALL DEMO until `GET /customer/bookings` gave the history list real rows to link to. It reads
 * `GET /customer/bookings/:id`, the same endpoint the live trip screen uses.
 *
 * FOUR SECTIONS LOST THEIR INVENTED PARTS, and none of them was replaced with a plausible
 * constant: the driver's rating, years of experience and vehicle list; the payment transaction id;
 * the invoice discount line; and "Your rating". None exists in `@driverzone/contracts`. The
 * timeline and the invoice, by contrast, turned out to be the parts the API models best — the
 * timeline is `timestamps`, the invoice is `fare.lines` plus `adjustments`.
 *
 * STILL A DIFFERENT SCREEN FROM `app/trip/[id].tsx`, which polls a trip that is happening now and
 * carries the start OTP, the cancel bar and the live status. This one is a receipt: no polling, no
 * actions, and it is reached from history rather than from booking.
 */
export default function RideDetailScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();

  /*
   * Shares `keys.bookings.detail(id)` with the trip screen deliberately — it is the same booking
   * from the same endpoint, so opening a recent trip from history reads the cache the trip screen
   * already filled instead of a second request.
   */
  const booking = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: () => getBooking(id),
  });

  const ride = booking.data;

  if (booking.isPending) {
    return (
      <View style={styles.root}>
        <Header />
        <View style={styles.centre}>
          <ActivityIndicator color={colors.muted} />
        </View>
      </View>
    );
  }

  if (booking.isError || ride === undefined) {
    return (
      <View style={styles.root}>
        <Header />
        <View style={styles.centre}>
          <Text style={styles.notFound}>
            {booking.error instanceof Error
              ? booking.error.message
              : 'This ride could not be found.'}
          </Text>
        </View>
      </View>
    );
  }

  const status = toRideStatus(ride);
  const when = new Date(rideHappenedAt(ride));
  const steps = timelineOf(ride);
  const paidAt = ride.timestamps.completed_at;

  return (
    <View style={styles.root}>
      <Header onDownload={() => void shareInvoice(ride)} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <SummaryRow label="Booking ID" value={ride.reference} />
          <SummaryRow label="Date & Time" value={formatDateTime(when)} />
          <SummaryRow
            label="Status"
            value={STATUS_LABEL[status]}
            valueColor={STATUS_COLOR[status]}
          />
          {/* When the trip actually ran, beside when it was booked for — each once it happened. */}
          {ride.timestamps.started_at === null ? null : (
            <SummaryRow
              label="Start time"
              value={formatDateTime(new Date(ride.timestamps.started_at))}
            />
          )}
          {ride.timestamps.completed_at === null ? null : (
            <SummaryRow
              label="End time"
              value={formatDateTime(new Date(ride.timestamps.completed_at))}
            />
          )}
          {ride.timestamps.started_at === null || ride.timestamps.completed_at === null ? null : (
            <SummaryRow
              label="Trip duration"
              value={formatDuration(
                new Date(ride.timestamps.started_at),
                new Date(ride.timestamps.completed_at),
              )}
            />
          )}
          <SummaryRow label="Trip Type" value={SERVICE_LABEL[ride.service_type]} />
          {ride.car_plate === null ? null : <SummaryRow label="Car number" value={ride.car_plate} />}
          {/* Only on bookings placed since the car choice existed — older rows have no answer,
              and a dash there would read as "no car" rather than "never asked". */}
          {ride.car_category === null ? null : (
            <SummaryRow
              label="Car"
              value={
                ride.vehicle_type === null
                  ? CAR_CATEGORY_LABELS[ride.car_category]
                  : `${CAR_CATEGORY_LABELS[ride.car_category]} · ${VEHICLE_TYPE_LABELS[ride.vehicle_type]}`
              }
            />
          )}
        </View>

        {/* No card at all rather than an empty one: a trip that never found a driver has nothing
            to say here, and "Driver details: —" is a worse answer than the absence. */}
        {ride.driver === null ? null : (
          <SectionCard title="Driver details">
            {/*
              The same card the live trip screen shows, and the call button is absent here for a
              reason that lives on the SERVER rather than in a prop: `driver.phone` is null on a
              finished trip, so `DriverCard` renders no number and no button without being told
              which screen it is on. A history that could still ring the driver would be a
              permanent line to their personal phone, months after the trip.
            */}
            {/* The heart is offered only on a trip that actually finished — the API refuses a
                driver the customer has not completed a trip with, and the ride list carries
                cancelled and no-driver rows too. */}
            <DriverCard driver={ride.driver} favouritable={ride.status === 'COMPLETED'} />
          </SectionCard>
        )}

        {steps.length === 0 ? null : (
          <SectionCard title="Trip timeline">
            {steps.map((step, index) => (
              <View key={step.label} style={styles.timelineRow}>
                <View style={styles.timelineMarkerCol}>
                  <View
                    style={[
                      styles.timelineDot,
                      { borderColor: TIMELINE_COLORS[index % TIMELINE_COLORS.length] },
                    ]}
                  />
                  {index === steps.length - 1 ? null : <View style={styles.timelineLine} />}
                </View>
                <View style={styles.timelineText}>
                  <View style={styles.timelineTopRow}>
                    <Text style={styles.timelineLabel}>{step.label}</Text>
                    <Text style={styles.timelineTime}>{formatClock(new Date(step.at))}</Text>
                  </View>
                  {step.note === null ? null : (
                    <Text style={styles.timelineNote}>{step.note}</Text>
                  )}
                </View>
              </View>
            ))}
          </SectionCard>
        )}

        <View style={styles.twoCol}>
          <SectionCard title="Fare breakdown" style={styles.colCard}>
            {/*
              THE SAME BREAKDOWN AS THE LIVE TRIP SCREEN — one component, so the receipt and the
              trip cannot disagree: fare lines, subtotal and GST, waiting and extra days, the
              wallet, and the server's own `payable.total`.
            */}
            <FareBreakdown booking={ride} />
          </SectionCard>

          <SectionCard title="Payment status" style={styles.colCard}>
            {status === 'CANCELLED' ? (
              /*
               * Says nothing about a cancellation FEE, which is a charge row against the customer
               * and not this booking's payment. Claiming "no payment was collected" where a fee
               * was is exactly the kind of thing a customer would screenshot.
               */
              <Text style={styles.paymentNone}>This trip was not completed.</Text>
            ) : (
              <>
                {/* "Paid" only once the trip is done. A cash trip is settled with the driver at
                    the end, so a running trip showing Paid would be wrong on the common path. */}
                {paidAt === null ? null : (
                  <View style={styles.paidChip}>
                    <Text style={styles.paidChipText}>Paid</Text>
                  </View>
                )}
                <Text style={styles.paymentLabel}>Payment method</Text>
                <Text style={styles.paymentValue}>{paidViaLabel(ride) ?? 'Not chosen'}</Text>
                {paidAt === null ? null : (
                  <>
                    <Text style={styles.paymentLabel}>Paid on</Text>
                    <Text style={styles.paymentValue}>{formatDateTime(new Date(paidAt))}</Text>
                  </>
                )}
              </>
            )}
          </SectionCard>
        </View>

        {ride.cancellation_reason === null ? null : (
          <SectionCard title="Why it was cancelled">
            <Text style={styles.paymentValue}>{ride.cancellation_reason}</Text>
          </SectionCard>
        )}

        {/*
          BOOK AGAIN — the same two places, on the home map, ready to price.

          OFFERED ON A CANCELLED TRIP TOO, and that is the point rather than an oversight: a trip
          that never found a driver is the one a customer is most likely to want to place again.
          It is hidden on a trip still ahead of them — RUNNING, where "book again" would be an
          invitation to double-book the ride they are currently on, and SCHEDULED, where it would
          be an invitation to book Tuesday's trip a second time.
        */}
        {status === 'RUNNING' || status === 'SCHEDULED' ? null : (
          <View style={styles.rebook}>
            <PrimaryButton
              label="Book again"
              onPress={() => router.push({ pathname: '/home', params: rebookParamsFor(ride) })}
            />
            <Text style={styles.rebookHint}>
              We will fill in the same pickup and destination. Choose a new time before you
              continue.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

interface TimelineStep {
  label: string;
  at: string;
  note: string | null;
}

/**
 * The trip's own timestamps, in the order they can only ever happen in.
 *
 * BUILT BY FILTERING, not by assuming. A cancelled trip has no `started_at`, a trip that ended
 * early has no `arrived_at`, and every one of the six is independently nullable — so each step is
 * included only if its timestamp exists, and a booking with none renders no card at all.
 */
function timelineOf(booking: BookingDto): TimelineStep[] {
  const { timestamps } = booking;

  const candidates: Array<{ label: string; at: string | null; note: string | null }> = [
    { label: 'Driver assigned', at: timestamps.assigned_at, note: booking.driver?.name ?? null },
    { label: 'On the way', at: timestamps.en_route_at, note: null },
    { label: 'Arrived at pickup', at: timestamps.arrived_at, note: booking.pickup.address },
    { label: 'Trip started', at: timestamps.started_at, note: null },
    { label: 'Trip completed', at: timestamps.completed_at, note: booking.drop.address },
    { label: 'Cancelled', at: timestamps.cancelled_at, note: booking.cancellation_reason },
  ];

  return candidates.filter((step): step is TimelineStep => step.at !== null);
}

function Header({ onDownload }: { onDownload?: () => void }): ReactElement {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.headerSide}
      >
        <Feather name="x" size={22} color={colors.fg} />
      </Pressable>
      <Text style={styles.headerTitle}>Ride Detail</Text>
      {onDownload === undefined ? (
        <View style={styles.headerSide} />
      ) : (
        <Pressable
          onPress={onDownload}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Download invoice"
          style={styles.headerDownload}
        >
          <Feather name="download" size={15} color={colors.fg} />
          <Text style={styles.headerDownloadLabel}>Invoice</Text>
        </Pressable>
      )}
    </View>
  );
}

function SummaryRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}): ReactElement {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, valueColor !== undefined && { color: valueColor }]}>
        {value}
      </Text>
    </View>
  );
}

function SectionCard({
  title,
  children,
  style,
}: {
  title: string;
  children: ReactNode;
  style?: object;
}): ReactElement {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

const STATUS_LABEL: Record<RideStatus, string> = {
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RUNNING: 'Running',
  SCHEDULED: 'Scheduled',
};
const STATUS_COLOR: Record<RideStatus, string> = {
  COMPLETED: colors.success,
  CANCELLED: colors.danger,
  RUNNING: colors.link,
  // Matches the list's pill. See `STATUS_COPY` in `(tabs)/rides.tsx` on why this is not the
  // running blue.
  SCHEDULED: '#7A5E00',
};

/** `ServiceType` reads as an enum on the wire; this is what a customer calls it. */
const SERVICE_LABEL: Record<BookingDto['service_type'], string> = {
  INCITY: 'In city',
  OUTSTATION: 'Outstation',
};
const TIMELINE_COLORS = [colors.success, colors.brand, colors.danger];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatClock(at: Date): string {
  const hours = at.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} ${suffix}`;
}

function formatDate(at: Date): string {
  return `${String(at.getDate()).padStart(2, '0')} ${MONTHS[at.getMonth()]} ${String(at.getFullYear())}`;
}

function formatDateTime(at: Date): string {
  return `${formatDate(at)}, ${formatClock(at)}`;
}

/**
 * "Download Invoice" WITHOUT A PDF SERVICE — nothing in this API generates one. The honest
 * client-only equivalent is handing the OS Share sheet a plain-text summary, which lets the
 * customer actually save or send it (to Files, WhatsApp, email — whatever the sheet offers) rather
 * than pressing a button that does nothing.
 */
async function shareInvoice(ride: BookingDto): Promise<void> {
  const lines = [
    `DriverZone — Invoice`,
    `Booking ID: ${ride.reference}`,
    `Date: ${formatDateTime(new Date(rideHappenedAt(ride)))}`,
    `From: ${ride.pickup.address}`,
    `To: ${ride.drop.address}`,
    '',
    // The same rows the screen shows, so the shared invoice and the receipt agree line for line.
    ...fareBreakdownRows(ride).map((row) => `${row.label}: ${row.value}`),
    '',
    `Total: ${ride.payable.total.amount_display}`,
    ...(paidViaLabel(ride) === null ? [] : [`Paid via: ${paidViaLabel(ride) ?? ''}`]),
  ];

  try {
    await Share.share({ message: lines.join('\n') });
  } catch {
    Alert.alert('Could not open the share sheet.');
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  notFound: { ...text.body, color: colors.muted },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSide: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg, flex: 1, textAlign: 'center' },
  headerDownload: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerDownloadLabel: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },

  content: { padding: space.lg, paddingBottom: space.xl },

  demoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSunken,
    marginBottom: space.md,
  },
  demoBadgeText: { ...text.caption, color: colors.muted },

  summaryCard: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs },
  summaryLabel: { ...text.caption, color: colors.muted },
  summaryValue: { ...text.label, color: colors.fg },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
  },
  cardTitle: { ...text.label, color: colors.fg, marginBottom: space.sm },


  timelineRow: { flexDirection: 'row' },
  timelineMarkerCol: { alignItems: 'center', width: 20 },
  timelineDot: {
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 3,
    backgroundColor: colors.card,
  },
  timelineLine: { width: 2, flex: 1, minHeight: 30, backgroundColor: colors.border },
  timelineText: { flex: 1, paddingBottom: space.md, paddingLeft: space.sm },
  timelineTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  timelineLabel: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  timelineTime: { ...text.caption, color: colors.muted },
  timelineNote: { ...text.caption, color: colors.faint, marginTop: 1 },

  twoCol: { flexDirection: 'row', gap: space.sm },
  // Overrides `card`'s padding down — two columns side by side have half the width to work with,
  // and `space.lg` on each edge was crowding out the numbers it was supposed to be framing.
  colCard: { flex: 1, padding: space.sm },

  rebook: { marginTop: space.lg, gap: space.sm },
  rebookHint: { ...text.caption, color: colors.muted, textAlign: 'center' },

  paidChip: {
    alignSelf: 'flex-start',
    backgroundColor: '#E7F5EC',
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    marginBottom: space.sm,
  },
  paidChipText: { ...text.caption, color: colors.success, fontFamily: fontFamily.semibold },
  paymentNone: { ...text.caption, color: colors.muted },
  paymentLabel: { ...text.caption, color: colors.faint, marginTop: space.xs },
  paymentValue: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },

  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  starsRow: { flexDirection: 'row' },
  starSpacing: { marginRight: 2 },
  ratedOn: { ...text.caption, color: colors.muted },
});
