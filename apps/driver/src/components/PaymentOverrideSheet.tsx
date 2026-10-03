import type { BookingDto, PaymentOverrideReason } from '@driverzone/contracts';
import { useMutation } from '@tanstack/react-query';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppIcon } from '@/components/AppIcon';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { overridePayment } from '@/lib/api/endpoints/trip';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/** What a driver reads; the server's code goes on the booking's event log. */
const REASONS: ReadonlyArray<{ value: PaymentOverrideReason; label: string }> = [
  { value: 'CUSTOMER_PHONE_UNAVAILABLE', label: "Customer's phone is dead or unavailable" },
  { value: 'WEB_BOOKING', label: 'Booked on the website — customer has no app' },
  { value: 'ONLINE_PAYMENT_FAILING', label: 'Online payment keeps failing' },
  { value: 'OTHER', label: 'Something else' },
];

interface PaymentOverrideSheetProps {
  visible: boolean;
  /** Read at render, so the amount shown is the one the server is holding now. */
  booking: BookingDto;
  onClose: () => void;
  onDone: (booking: BookingDto) => void;
}

/**
 * THE DRIVER TAKES THE PAYMENT IN CASH because the customer cannot finish it in their app.
 *
 * **The amount comes first, large.** It is the server's `payable.total`, which already includes
 * any old cancellation fee the customer owes — the driver takes that too, and it is then cleared.
 * Saying so here is what stops a driver collecting the fare alone and being booked for the fee.
 *
 * **A reason is required** — the server refuses without one, and `Something else` needs a line of
 * explanation — because every override is written to the booking's event log under this driver.
 * Confirm stays disabled until the form is complete rather than failing at the server.
 */
export function PaymentOverrideSheet({
  visible,
  booking,
  onClose,
  onDone,
}: PaymentOverrideSheetProps): ReactElement {
  const [reason, setReason] = useState<PaymentOverrideReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Reopened, it starts blank: a pre-selected reason is one tap from being submitted unread.
  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setNote('');
    setError(null);
  }, [visible]);

  const submit = useMutation({
    mutationFn: () =>
      overridePayment(booking.id, {
        reason: reason ?? 'OTHER',
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      }),
    onMutate: () => setError(null),
    onSuccess: (result) => onDone(result.booking),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not switch this trip to cash.'),
  });

  const oldFee = booking.payable.wallet_debt.amount_paise > 0 ? booking.payable.wallet_debt : null;
  const needsNote = reason === 'OTHER' && note.trim() === '';

  return (
    <BottomSheet visible={visible} onClose={submit.isPending ? () => undefined : onClose}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <AppIcon name="rupee" size={22} color={colors.warning} />
        </View>

        <Text style={styles.title}>Collect payment in cash</Text>
        <Text style={styles.body}>
          Use this when the customer can’t pay in the app. Collect this amount, then end the trip.
        </Text>

        <View style={styles.amountBox}>
          <Text style={styles.amountLabel}>Collect from the customer</Text>
          <Text style={styles.amount}>{booking.payable.total.amount_display}</Text>
          {oldFee !== null ? (
            <Text style={styles.amountNote}>
              Includes {oldFee.amount_display} the customer owes from an earlier cancelled trip.
            </Text>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>Why can’t the customer pay in the app?</Text>
        {REASONS.map((option) => {
          const selected = reason === option.value;
          return (
            <Pressable
              key={option.value}
              onPress={() => setReason(option.value)}
              disabled={submit.isPending}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [
                styles.reason,
                selected && styles.reasonSelected,
                pressed && styles.pressed,
              ]}
            >
              <View style={[styles.radio, selected && styles.radioOn]}>
                {selected ? <View style={styles.radioDot} /> : null}
              </View>
              <Text style={[styles.reasonLabel, selected && styles.reasonLabelSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}

        {reason === 'OTHER' ? (
          <TextInput
            value={note}
            onChangeText={setNote}
            editable={!submit.isPending}
            placeholder="Tell us briefly what happened"
            placeholderTextColor={colors.faint}
            multiline
            maxLength={300}
            style={styles.note}
            accessibilityLabel="What happened"
            autoFocus
            onFocus={() =>
              requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
            }
          />
        ) : null}

        {error !== null ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label={`I’ll collect ${booking.payable.total.amount_display} in cash`}
            onPress={() => submit.mutate()}
            loading={submit.isPending}
            disabled={reason === null || needsNote}
            showArrow={false}
          />
          <Pressable
            onPress={onClose}
            disabled={submit.isPending}
            accessibilityRole="button"
            style={styles.keep}
          >
            <Text style={styles.keepLabel}>Not now</Text>
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
  amountNote: { ...text.caption, color: colors.warning, textAlign: 'center', marginTop: space.xs },

  sectionLabel: {
    ...text.label,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.lg,
    marginBottom: space.xs,
  },

  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
  },
  reasonSelected: { backgroundColor: colors.bgSunken },
  radio: {
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.fg },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.fg },
  reasonLabel: { ...text.body, color: colors.fg, flex: 1 },
  reasonLabelSelected: { fontFamily: fontFamily.semibold },

  note: {
    ...text.body,
    color: colors.fg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.sm,
    minHeight: 64,
    textAlignVertical: 'top',
  },

  error: { ...text.caption, color: colors.danger, marginTop: space.sm },

  actions: { marginTop: space.lg },
  keep: { alignItems: 'center', paddingVertical: space.md },
  keepLabel: { ...text.body, color: colors.muted },
});
