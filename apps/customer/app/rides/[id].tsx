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
import {
  CAR_CATEGORY_LABELS,
  VEHICLE_TYPE_LABELS,
  type BookingDto,
  type Money,
} from '@driverzone/contracts';
import {
  rideHappenedAt,
  rideTotalPaise,
  toRideStatus,
  type RideStatus,
} from '@/features/rides/rideHistory';
import { getBooking } from '@/lib/api/endpoints/bookings';
import { formatPaise } from '@/lib/money';
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

  const status = toRideStatus(ride.status);
  const when = new Date(rideHappenedAt(ride));
  const totalPaise = rideTotalPaise(ride);
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
          <SummaryRow label="Trip Type" value={SERVICE_LABEL[ride.service_type]} />
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
            <View style={styles.driverRow}>
              <View style={styles.avatar}>
                <Feather name="user" size={22} color={colors.fg} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.driverName}>{ride.driver.name ?? 'Your driver'}</Text>
              </View>
            </View>
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
          <SectionCard title="Invoice summary" style={styles.colCard}>
            {ride.fare.lines.map((line) => (
              <InvoiceRow key={line.code} label={line.label} amount={line.amount} />
            ))}
            {/*
              ADJUSTMENTS ARE LISTED, NOT FOLDED IN. Waiting time and a late fine are decided
              after the quote and never edit the fare (invariant B-1) — a customer looking at a
              bill bigger than the price they agreed to is owed the line that explains it.
            */}
            {ride.adjustments.map((adjustment) => (
              <InvoiceRow
                key={adjustment.type}
                label={adjustment.label}
                amount={adjustment.amount}
              />
            ))}
            {/*
              WHAT THE WALLET DID, as its own lines below the fare. Neither edits `fare.total` —
              the credit came off what was payable and the debt was an older fee collected with
              this trip — so folding them into the total would make the receipt disagree with the
              fare the customer agreed to.
            */}
            {ride.wallet_credit.amount_paise > 0 ? (
              <InvoiceRow label="Wallet credit" amount={negated(ride.wallet_credit)} />
            ) : null}
            {ride.wallet_debt.amount_paise > 0 ? (
              <InvoiceRow label="Earlier cancellation fee" amount={ride.wallet_debt} />
            ) : null}

            <View style={styles.rule} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>{formatPaise(totalPaise)}</Text>
            </View>
            {ride.wallet_credit.amount_paise > 0 || ride.wallet_debt.amount_paise > 0 ? (
              <Text style={styles.paidNote}>
                You paid{' '}
                {formatPaise(
                  totalPaise - ride.wallet_credit.amount_paise + ride.wallet_debt.amount_paise,
                )}{' '}
                for this trip.
              </Text>
            ) : null}
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
                <Text style={styles.paymentValue}>{ride.payment_mode}</Text>
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

/**
 * Renders the server's own `amount_display` rather than reformatting the paise — the API is the
 * one place fare formatting is decided, so all four clients show a line identically. A negative
 * line (a discount, if one ever ships) keeps the green treatment.
 */
function InvoiceRow({ label, amount }: { label: string; amount: Money }): ReactElement {
  const negative = amount.amount_paise < 0;

  return (
    <View style={styles.invoiceRow}>
      <Text style={styles.invoiceLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.invoiceValue, negative && styles.invoiceValueGood]}>
        {amount.amount_display}
      </Text>
    </View>
  );
}

/**
 * Flips a Money's sign for display, keeping the server's formatting.
 *
 * Wallet credit comes down as a POSITIVE figure — it is credit, and the wallet screen reads it
 * that way — but on an invoice it is a deduction, so it has to render with a minus without this
 * screen reformatting the rupees itself.
 */
function negated(amount: Money): Money {
  return {
    amount_paise: -amount.amount_paise,
    amount_display: `-${amount.amount_display}`,
  };
}

const STATUS_LABEL: Record<RideStatus, string> = {
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RUNNING: 'Running',
};
const STATUS_COLOR: Record<RideStatus, string> = {
  COMPLETED: colors.success,
  CANCELLED: colors.danger,
  RUNNING: colors.link,
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
    ...ride.fare.lines.map((line) => `${line.label}: ${line.amount.amount_display}`),
    ...ride.adjustments.map((a) => `${a.label}: ${a.amount.amount_display}`),
    '',
    `Total: ${formatPaise(rideTotalPaise(ride))}`,
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

  driverRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  driverNameRow: { flexDirection: 'row', alignItems: 'center' },
  driverName: { ...text.body, color: colors.fg, fontFamily: fontFamily.bold },
  starIcon: { marginLeft: space.xs, marginRight: 2 },
  driverRating: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },
  driverMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  metaIcon: { marginRight: 5 },
  driverMeta: { ...text.caption, color: colors.muted },

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

  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  invoiceLabel: { ...text.caption, color: colors.muted, flex: 1, marginRight: space.xs },
  invoiceValue: { ...text.caption, color: colors.fg },
  invoiceValueGood: { color: colors.success },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, fontSize: 13 },
  totalValue: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, fontSize: 13 },
  paidNote: { ...text.caption, color: colors.muted, marginTop: space.xs },

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
