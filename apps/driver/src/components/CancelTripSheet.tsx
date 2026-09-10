import { Feather } from '@expo/vector-icons';
import type { BookingStatus, CancelBookingResponse, SettingValue } from '@driverzone/contracts';
import { useMutation } from '@tanstack/react-query';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { CANCEL_REASONS, driverPenaltyPaise } from '@/features/trip/cancellation';
import { cancelTrip } from '@/lib/api/endpoints/trip';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface CancelTripSheetProps {
  visible: boolean;
  bookingId: string;
  /** The status the trip is at NOW — it decides the penalty, so it must not be captured earlier. */
  status: BookingStatus;
  /** From `GET /driver/settings`; `undefined` while it loads or if the read failed. */
  settings: Record<string, SettingValue> | undefined;
  onClose: () => void;
  onCancelled: (result: CancelBookingResponse) => void;
}

/**
 * DROPPING A TRIP — the one destructive thing a driver can do to a customer who is waiting.
 *
 * **It states the penalty first, and that is the whole point of the sheet.** The customer-side
 * equivalent deliberately does not preview its fee, because the customer ladder depends on a
 * clock and a preview would go stale between rendering and tapping. A driver's penalty depends
 * only on the status they are at, so it is exact — and it is money taken off their next payout,
 * which is precisely the thing nobody should discover afterwards.
 *
 * **A reason is required by the server** (`requireReason` → 400 on an empty one), and it is not
 * bureaucracy: it becomes the message the customer is sent and the note on the driver's own
 * `PENALTY` ledger row. So the sheet cannot submit without one, and Confirm stays disabled rather
 * than failing at the server.
 *
 * **Two steps, not one.** Choosing a reason and confirming are separated so that the destructive
 * tap is never the one a driver makes by reflex while reading — the same reason the trip screen
 * ends a trip with a slide rather than a button.
 */
export function CancelTripSheet({
  visible,
  bookingId,
  status,
  settings,
  onClose,
  onCancelled,
}: CancelTripSheetProps): ReactElement {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * The note sits near the foot of the sheet with the confirm button under it, so the keyboard
   * lands on both. `BottomSheet` lifts the sheet clear of the keys and caps its height, which
   * hands the overflow to this ScrollView — but a ScrollView does not move itself, so without
   * this the driver focuses the box and finds it, and the button under it, below the fold.
   */
  const scrollRef = useRef<ScrollView>(null);

  // A sheet reopened after a change of heart must not still hold the last choice — a pre-selected
  // reason on a destructive form is one tap away from being submitted unread.
  useEffect(() => {
    if (!visible) return;
    setReason(null);
    setNote('');
    setError(null);
  }, [visible]);

  const penaltyPaise = driverPenaltyPaise(status, settings);
  const settingsKnown = settings !== undefined;

  const cancel = useMutation({
    mutationFn: () => {
      const trimmedNote = note.trim();
      /*
       * The note is APPENDED to the reason rather than sent separately: the server takes one
       * `reason` string, and it is what the customer is told and what the ledger row records. A
       * note dropped on the floor here would be a driver explaining themselves to nobody.
       */
      const full =
        trimmedNote === '' ? (reason ?? '') : `${reason ?? ''} — ${trimmedNote}`;
      return cancelTrip(bookingId, full);
    },
    onMutate: () => setError(null),
    onSuccess: onCancelled,
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'We could not cancel this trip.'),
  });

  return (
    <BottomSheet visible={visible} onClose={cancel.isPending ? () => undefined : onClose}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <Feather name="x-octagon" size={24} color={colors.danger} />
        </View>

        <Text style={styles.title}>Cancel this trip?</Text>
        <Text style={styles.body}>
          The customer is waiting for you. We will look for another driver for them.
        </Text>

        {/*
          THE PENALTY, up front. Three different sentences for three different truths — a real
          charge, a genuine zero, and "we could not check" — because rendering the last two the
          same way would promise a driver something this screen does not actually know.
        */}
        <View style={[styles.penalty, penaltyPaise > 0 && styles.penaltyCharged]}>
          <Feather
            name={penaltyPaise > 0 ? 'alert-triangle' : 'info'}
            size={16}
            color={penaltyPaise > 0 ? colors.warning : colors.muted}
          />
          <Text style={styles.penaltyText}>
            {!settingsKnown
              ? 'A penalty may be charged depending on how far along this trip is. Your earnings screen will show it.'
              : penaltyPaise > 0
                ? `₹${String(penaltyPaise / 100)} will be taken off your earnings for cancelling now.`
                : 'No penalty for cancelling at this stage.'}
          </Text>
        </View>

        <Text style={styles.sectionLabel}>Why are you cancelling?</Text>
        {CANCEL_REASONS.map((option) => {
          const selected = reason === option;
          return (
            <Pressable
              key={option}
              onPress={() => setReason(option)}
              disabled={cancel.isPending}
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
                {option}
              </Text>
            </Pressable>
          );
        })}

        <TextInput
          value={note}
          onChangeText={setNote}
          editable={!cancel.isPending}
          placeholder="Anything to add? (optional)"
          placeholderTextColor={colors.faint}
          multiline
          maxLength={160}
          style={styles.note}
          accessibilityLabel="Add a note"
          // A frame later: the sheet is still being lifted by the keyboard when focus fires, so
          // scrolling immediately measures the pre-keyboard height and stops short.
          onFocus={() =>
            requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
          }
        />

        {error !== null ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton
            label="Cancel this trip"
            onPress={() => cancel.mutate()}
            loading={cancel.isPending}
            // A reason is required server-side; disabling here means the driver never meets a 400
            // for something the form could have told them.
            disabled={reason === null}
            showArrow={false}
          />
          <Pressable
            onPress={onClose}
            disabled={cancel.isPending}
            accessibilityRole="button"
            style={styles.keep}
          >
            <Text style={styles.keepLabel}>Keep the trip</Text>
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
    backgroundColor: '#FDEEF0',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.md,
  },
  title: { ...text.heading, color: colors.fg, textAlign: 'center' },
  body: {
    ...text.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xs,
  },

  penalty: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.lg,
  },
  penaltyCharged: { backgroundColor: '#FFF6E0' },
  penaltyText: { ...text.caption, color: colors.fg, flex: 1 },

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
