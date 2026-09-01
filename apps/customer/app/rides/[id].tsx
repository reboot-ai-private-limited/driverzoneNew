import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import {
  type DemoInvoiceLine,
  type DemoRide,
  findDemoRide,
  formatDemoPaise,
} from '@/features/rides/demoRides';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * Ride detail — reached only from the demo Ride History list.
 *
 * ALL DEMO, for the same reason the list above it is: there is no `GET /customer/bookings/:id`
 * for a booking this app didn't just make, and no endpoint at all for a driver's photo, rating,
 * phone, experience or vehicle list, a payment transaction id, or an invoice discount line — none
 * of these exist anywhere in `@driverzone/contracts` today.
 *
 * This is a DIFFERENT screen from `app/trip/[id].tsx`, which is real, reads the actual booking
 * API, and is what a customer sees for a trip they just booked. That screen intentionally omits
 * everything this one shows, because it has nothing honest to show it with.
 */
export default function RideDetailScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ride = findDemoRide(id);

  if (ride === null) {
    return (
      <View style={styles.root}>
        <Header />
        <View style={styles.centre}>
          <Text style={styles.notFound}>This ride could not be found.</Text>
        </View>
      </View>
    );
  }

  const when = new Date(ride.at);
  const total = ride.invoice.reduce((sum, line) => sum + line.amount, 0) - ride.discountPaise;

  return (
    <View style={styles.root}>
      <Header onDownload={() => void shareInvoice(ride)} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.demoBadge}>
          <Feather name="info" size={12} color={colors.muted} />
          <Text style={styles.demoBadgeText}>Demo data — not a real ride.</Text>
        </View>

        <View style={styles.summaryCard}>
          <SummaryRow label="Booking ID" value={ride.id} />
          <SummaryRow label="Date & Time" value={formatDateTime(when)} />
          <SummaryRow
            label="Status"
            value={STATUS_LABEL[ride.status]}
            valueColor={STATUS_COLOR[ride.status]}
          />
          <SummaryRow label="Trip Type" value={ride.tripType} />
        </View>

        <SectionCard title="Driver details">
          <View style={styles.driverRow}>
            <View style={styles.avatar}>
              <Feather name="user" size={22} color={colors.fg} />
            </View>
            <View style={styles.flex}>
              <View style={styles.driverNameRow}>
                <Text style={styles.driverName}>{ride.driverName}</Text>
                <Feather name="star" size={13} color={colors.brand} style={styles.starIcon} />
                <Text style={styles.driverRating}>{ride.driverRating.toFixed(1)}</Text>
              </View>
              <View style={styles.driverMetaRow}>
                <Feather name="shield" size={12} color={colors.muted} style={styles.metaIcon} />
                <Text style={styles.driverMeta}>
                  {ride.driverExperienceYears}+ Years Experience
                </Text>
              </View>
              <View style={styles.driverMetaRow}>
                <Feather name="truck" size={12} color={colors.muted} style={styles.metaIcon} />
                <Text style={styles.driverMeta}>{ride.driverVehicles}</Text>
              </View>
            </View>
          </View>
        </SectionCard>

        <SectionCard title="Trip timeline">
          {ride.timeline.map((step, index) => (
            <View key={step.label} style={styles.timelineRow}>
              <View style={styles.timelineMarkerCol}>
                <View
                  style={[
                    styles.timelineDot,
                    { borderColor: TIMELINE_COLORS[index % TIMELINE_COLORS.length] },
                  ]}
                />
                {index === ride.timeline.length - 1 ? null : <View style={styles.timelineLine} />}
              </View>
              <View style={styles.timelineText}>
                <View style={styles.timelineTopRow}>
                  <Text style={styles.timelineLabel}>{step.label}</Text>
                  <Text style={styles.timelineTime}>{formatClock(new Date(step.at))}</Text>
                </View>
                <Text style={styles.timelineNote}>{step.note}</Text>
              </View>
            </View>
          ))}
        </SectionCard>

        <View style={styles.twoCol}>
          <SectionCard title="Invoice summary" style={styles.colCard}>
            {ride.invoice.map((line) => (
              <InvoiceRow key={line.label} line={line} />
            ))}
            {ride.discountPaise > 0 ? (
              <InvoiceRow line={{ label: 'Discount', amount: -ride.discountPaise }} tone="good" />
            ) : null}
            <View style={styles.rule} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>{formatDemoPaise(total)}</Text>
            </View>
          </SectionCard>

          <SectionCard title="Payment status" style={styles.colCard}>
            {ride.status === 'CANCELLED' ? (
              <Text style={styles.paymentNone}>No payment was collected.</Text>
            ) : (
              <>
                <View style={styles.paidChip}>
                  <Text style={styles.paidChipText}>Paid</Text>
                </View>
                <Text style={styles.paymentLabel}>Payment method</Text>
                <Text style={styles.paymentValue}>{ride.paymentMethod}</Text>
                <Text style={styles.paymentLabel}>Paid on</Text>
                <Text style={styles.paymentValue}>{formatDateTime(when)}</Text>
                {ride.transactionId === null ? null : (
                  <>
                    <Text style={styles.paymentLabel}>Transaction ID</Text>
                    <Text style={styles.paymentValue} numberOfLines={1}>
                      {ride.transactionId}
                    </Text>
                  </>
                )}
              </>
            )}
          </SectionCard>
        </View>

        {ride.yourRating === null ? null : (
          <SectionCard title="Your rating">
            <View style={styles.ratingRow}>
              <View style={styles.starsRow}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Feather
                    key={n}
                    name="star"
                    size={18}
                    color={n <= (ride.yourRating ?? 0) ? colors.brand : colors.border}
                    style={styles.starSpacing}
                  />
                ))}
              </View>
              <Text style={styles.ratedOn}>Rated on {formatDate(when)}</Text>
            </View>
          </SectionCard>
        )}
      </ScrollView>
    </View>
  );
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

function InvoiceRow({ line, tone }: { line: DemoInvoiceLine; tone?: 'good' }): ReactElement {
  return (
    <View style={styles.invoiceRow}>
      <Text style={styles.invoiceLabel} numberOfLines={1}>
        {line.label}
      </Text>
      <Text style={[styles.invoiceValue, tone === 'good' && styles.invoiceValueGood]}>
        {line.amount < 0 ? '-' : ''}
        {formatDemoPaise(Math.abs(line.amount))}
      </Text>
    </View>
  );
}

const STATUS_LABEL: Record<DemoRide['status'], string> = {
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RUNNING: 'Running',
};
const STATUS_COLOR: Record<DemoRide['status'], string> = {
  COMPLETED: colors.success,
  CANCELLED: colors.danger,
  RUNNING: colors.link,
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
async function shareInvoice(ride: DemoRide): Promise<void> {
  const total = ride.invoice.reduce((sum, line) => sum + line.amount, 0) - ride.discountPaise;
  const lines = [
    `DriverZone — Invoice`,
    `Booking ID: ${ride.id}`,
    `Date: ${formatDateTime(new Date(ride.at))}`,
    '',
    ...ride.invoice.map((line) => `${line.label}: ${formatDemoPaise(line.amount)}`),
    ...(ride.discountPaise > 0 ? [`Discount: -${formatDemoPaise(ride.discountPaise)}`] : []),
    '',
    `Total: ${formatDemoPaise(total)}`,
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
