import type { BookingDto } from '@driverzone/contracts';
import { type ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, space, text } from '@/theme/theme';

export interface FareRow {
  key: string;
  label: string;
  value: string;
  /** A subtotal line — set apart from the charges above it. */
  emphasis?: boolean;
}

/**
 * THE BILL, LINE BY LINE — the same rows on the live trip screen and on the ride receipt, so the
 * two cannot drift apart (they did, when each screen built its own list).
 *
 * Every figure is the server's own `amount_display`; nothing is added up here. The order is the
 * order a customer reads a bill in:
 *
 *   fare lines → Subtotal → GST → waiting / extra days → wallet credit / earlier dues → (Total)
 *
 * SUBTOTAL AND GST appear only when there is tax: `pricing` sums the lines into the subtotal and
 * adds tax on top, so without them the lines never visibly added up to the total.
 *
 * WAITING AND EXTRA DAYS while the trip runs come from `payable` (the waiting charge is known from
 * the moment the trip starts); once it ends the same money arrives as an adjustment row, and the
 * running line goes quiet — showing both would bill the customer for one charge twice.
 */
export function fareBreakdownRows(booking: BookingDto): FareRow[] {
  const rows: FareRow[] = booking.fare.lines.map((line) => ({
    key: `line_${line.code}`,
    label: line.label,
    value: line.amount.amount_display,
  }));

  if (booking.fare.tax.amount_paise > 0) {
    rows.push(
      { key: 'subtotal', label: 'Subtotal', value: booking.fare.subtotal.amount_display, emphasis: true },
      { key: 'tax', label: 'GST', value: booking.fare.tax.amount_display },
    );
  }

  booking.adjustments.forEach((adjustment, index) => {
    rows.push({
      key: `adj_${adjustment.type}_${String(index)}`,
      label: adjustment.label,
      value: adjustment.amount.amount_display,
    });
  });

  const hasAdjustment = (type: string) => booking.adjustments.some((a) => a.type === type);

  if (booking.payable.waiting_total.amount_paise > 0 && !hasAdjustment('WAITING_CHARGE')) {
    rows.push({
      key: 'waiting',
      label: 'Waiting time',
      value: booking.payable.waiting_total.amount_display,
    });
  }

  if (booking.payable.extension_total.amount_paise > 0 && !hasAdjustment('DAY_EXTENSION')) {
    rows.push({
      key: 'extension',
      label: booking.extension?.extra_days === 1 ? 'Extra day' : 'Extra days',
      value: booking.payable.extension_total.amount_display,
    });
  }

  if (booking.payable.wallet_credit.amount_paise > 0) {
    rows.push({
      key: 'credit',
      label: 'Wallet credit',
      value: `−${booking.payable.wallet_credit.amount_display}`,
    });
  }

  if (booking.payable.wallet_debt.amount_paise > 0) {
    rows.push({
      key: 'debt',
      label: 'Earlier unpaid charges',
      value: booking.payable.wallet_debt.amount_display,
    });
  }

  return rows;
}

/** How the trip is (or was) paid, in the customer's words. Null before a method exists. */
export function paidViaLabel(booking: BookingDto): string | null {
  const extras =
    booking.extras_collection === 'CASH'
      ? ' · extras in cash'
      : booking.extras_collection === 'UNPAID'
        ? ' · extras added to your next trip'
        : '';
  switch (booking.payment_mode) {
    case 'PREPAID':
      return `Prepaid${extras}`;
    case 'UPI':
      return `Online (UPI)${extras}`;
    case 'CASH':
      return 'Cash';
    default:
      return null;
  }
}

/**
 * The rows, the total and how it is paid. `payable.total` is the total — NOT `fare.total`: the
 * fare is frozen at booking time and says nothing about waiting, an extra day or the wallet.
 */
export function FareBreakdown({ booking }: { booking: BookingDto }): ReactElement {
  const paidVia = paidViaLabel(booking);

  return (
    <View>
      {fareBreakdownRows(booking).map((row) => (
        <View key={row.key} style={styles.row}>
          <Text style={[styles.label, row.emphasis === true && styles.emphasis]} numberOfLines={2}>
            {row.label}
          </Text>
          <Text style={[styles.value, row.emphasis === true && styles.emphasis]}>{row.value}</Text>
        </View>
      ))}

      <View style={styles.rule} />
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalLabel}>{booking.payable.total.amount_display}</Text>
      </View>

      {paidVia === null ? null : (
        <View style={styles.row}>
          <Text style={styles.label}>Paid via</Text>
          <Text style={styles.value}>{paidVia}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.xs,
  },
  label: { ...text.caption, color: colors.muted, flex: 1 },
  value: { ...text.body, color: colors.fg, textAlign: 'right' },
  emphasis: { color: colors.fg, fontFamily: fontFamily.semibold },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
});
