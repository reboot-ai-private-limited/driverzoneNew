import type { BookingDto, ExtrasCollection } from '@driverzone/contracts';
import { type ReactElement, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '@/components/AppIcon';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * What is still owed at the end of a UPI or prepaid trip, beyond the fare that is already settled:
 * the waiting charge (known since the trip started) and any extra day not yet paid.
 *
 * Zero on a CASH trip — there the driver takes everything at the door with the fare, and the
 * "collect in cash" note already says how much. Exported so the trip screen decides whether to
 * open this sheet at all from the same arithmetic the sheet shows.
 */
export function extrasOwedPaise(booking: BookingDto): number {
  if (booking.payment_mode !== 'UPI' && booking.payment_mode !== 'PREPAID') return 0;
  return booking.payable.waiting_total.amount_paise + booking.payable.outstanding.amount_paise;
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

interface Option {
  value: ExtrasCollection;
  label: string;
  hint: string;
}

interface EndTripExtrasSheetProps {
  visible: boolean;
  /** Read at render, so the amount shown is the one the server is holding now. */
  booking: BookingDto;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (collection: ExtrasCollection) => void;
}

/**
 * ENDING A TRIP THAT STILL HAS EXTRAS TO SETTLE — and saying how they were settled.
 *
 * CASH IS ALWAYS AN OPTION (2026-10-13). No charge is online-only: whatever the fare was paid by,
 * the driver can take the waiting time or the extra day in hand. "Didn't pay" is always there too,
 * so a trip can always be ended — the amount becomes the customer's dues and is collected on their
 * next trip, rather than the driver being stuck on a screen they cannot get past.
 *
 * "Charge online" appears only on a UPI trip with no extra day outstanding: there is an order on
 * file the waiting charge can be added to. An extra day the customer has not paid in their app
 * cannot be charged behind their back, so it is never offered for that.
 *
 * NOTHING IS PRE-SELECTED. The choice decides whether this driver is booked as holding cash, and a
 * default is one tap from being submitted unread.
 */
export function EndTripExtrasSheet({
  visible,
  booking,
  loading,
  error,
  onClose,
  onConfirm,
}: EndTripExtrasSheetProps): ReactElement {
  const [choice, setChoice] = useState<ExtrasCollection | null>(null);

  useEffect(() => {
    if (visible) setChoice(null);
  }, [visible]);

  const waiting = booking.payable.waiting_total.amount_paise;
  const extraDay = booking.payable.outstanding.amount_paise;
  const owed = waiting + extraDay;
  const canChargeOnline = booking.payment_mode === 'UPI' && extraDay === 0;

  const options: Option[] = [
    {
      value: 'CASH',
      label: `I collected ${rupees(owed)} in cash`,
      hint: 'You hold this cash for the company, like a cash fare.',
    },
    ...(canChargeOnline
      ? [
          {
            value: 'ONLINE' as const,
            label: 'Charge it to their online payment',
            hint: 'Added to the customer’s online payment for this trip.',
          },
        ]
      : []),
    {
      value: 'UNPAID',
      label: 'The customer didn’t pay',
      hint: 'The trip ends. The amount is added to the customer’s next trip.',
    },
  ];

  const confirmLabel =
    choice === 'CASH'
      ? `End trip — collected ${rupees(owed)}`
      : choice === 'UNPAID'
        ? 'End trip — not paid'
        : 'End trip';

  return (
    <BottomSheet visible={visible} onClose={loading ? () => undefined : onClose}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.iconWrap}>
          <AppIcon name="rupee" size={22} color={colors.warning} />
        </View>

        <Text style={styles.title}>Extra charges on this trip</Text>
        <Text style={styles.body}>
          {booking.payment_mode === 'PREPAID'
            ? 'The fare is prepaid. These extras were not part of it.'
            : 'The fare is paid online. These extras are still due.'}
        </Text>

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Still to collect</Text>
          <Text style={styles.amount}>{rupees(owed)}</Text>
          {waiting > 0 ? <Text style={styles.line}>Waiting time: {rupees(waiting)}</Text> : null}
          {extraDay > 0 ? <Text style={styles.line}>Extra day: {rupees(extraDay)}</Text> : null}
        </View>

        <Text style={styles.sectionLabel}>How was it paid?</Text>
        {options.map((option) => {
          const selected = choice === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setChoice(option.value)}
              disabled={loading}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.option,
                selected && styles.optionSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.radio, selected && styles.radioOn]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {option.label}
                </Text>
                <Text style={styles.optionHint}>{option.hint}</Text>
              </View>
            </Pressable>
          );
        })}

        {error !== null ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label={confirmLabel}
            onPress={() => {
              if (choice !== null) onConfirm(choice);
            }}
            loading={loading}
            disabled={choice === null}
            showArrow={false}
          />
          <Pressable onPress={onClose} disabled={loading} accessibilityRole="button" style={styles.keep}>
            <Text style={styles.keepLabel}>Not yet</Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  pressed: { opacity: 0.85 },

  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: '#FFF6E0',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.md,
  },
  title: { ...text.heading, color: colors.fg, textAlign: 'center' },
  body: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.xs },

  amountBox: {
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.lg,
  },
  amountLabel: { ...text.caption, color: colors.muted },
  amount: { ...text.title, color: colors.fg, fontFamily: fontFamily.bold, marginTop: 2 },
  line: { ...text.caption, color: colors.muted, marginTop: 2 },

  sectionLabel: {
    ...text.label,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.lg,
    marginBottom: space.xs,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  optionSelected: { backgroundColor: colors.bgSunken },
  radio: {
    width: 20,
    height: 20,
    marginTop: 2,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.fg },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.fg },
  optionText: { flex: 1 },
  optionLabel: { ...text.body, color: colors.fg },
  optionLabelSelected: { fontFamily: fontFamily.semibold },
  optionHint: { ...text.caption, color: colors.muted, marginTop: 2 },

  error: { ...text.caption, color: colors.danger, marginTop: space.sm },

  actions: { marginTop: space.lg },
  keep: { alignItems: 'center', paddingVertical: space.md },
  keepLabel: { ...text.body, color: colors.muted },
});
