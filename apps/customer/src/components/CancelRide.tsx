import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CancelBookingResponse } from '@driverzone/contracts';
import { PrimaryButton } from '@/components/PrimaryButton';
import { cancelBooking } from '@/lib/api/endpoints/bookings';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface CancelRideProps {
  visible: boolean;
  bookingId: string;
  /**
   * Whether a driver has already accepted. Picks which list of reasons is offered — see
   * `hasDriverAssigned` in `features/booking/status.ts` for why the two lists differ.
   */
  driverAssigned?: boolean;
  onClose: () => void;
  onCancelled: (result: CancelBookingResponse) => void;
}

/**
 * Cancelling a ride — a full screen, a radio list, and a confirmation.
 *
 * **IT WAS A BOTTOM SHEET THAT CANCELLED ON ONE TAP, and that was a deliberate design this
 * replaces deliberately.** The old sheet argued that the customer has already decided, is usually
 * standing somewhere, and that every extra second is one more second of a driver being sent to a
 * trip nobody wants — so each reason was a button and choosing one WAS the confirmation.
 *
 * What that traded away is the thing this action most needs: a moment to be sure. Cancelling
 * spends money, cannot be undone, and the sheet made it a single tap on a row in a list of rows —
 * one of them reachable by a thumb resting where "Keep waiting" used to be. Selecting a reason
 * and then pressing Next separates *saying why* from *doing it*, which is the separation a
 * destructive action is supposed to have.
 *
 * **The second step is where the fee finally gets stated.** The old sheet's own comment admitted
 * it should preview the cancellation ladder and did not; a confirm step is the place that belongs,
 * and it is now honest about the fee being possible rather than silent.
 *
 * **`Other` opens a box, and only it costs a keyboard.** The presets cover what customers actually
 * cancel for; anything else deserves free text rather than being squeezed into the nearest wrong
 * option, because this string is what an admin reads afterwards.
 *
 * A FULL SCREEN, NOT A SHEET, and that is what fixes the keyboard bug as well as the design: a
 * `Modal` is hoisted into its own window outside the activity that resizes for the keyboard, so a
 * sheet anchored to the bottom edge sits exactly where the keys land. A full-screen modal has the
 * whole viewport to give the input, and `KeyboardAvoidingView` works normally inside it.
 */

/** Nothing has been dispatched to yet — the wait itself is the usual complaint. */
const SEARCHING_REASONS = [
  'Taking too long to find a driver',
  'Booked by mistake',
  'Change of plans',
  'Selected wrong location',
  'Fare is too high',
  'Found another ride',
] as const;

/** Someone accepted and is on their way — the complaints are about them, not the search. */
const ASSIGNED_REASONS = [
  'Driver is taking too long',
  'Driver not responding',
  'Driver asked me to cancel',
  'Driver requesting extra fare',
  'Booked by mistake',
  'Change of plans',
  'Found another ride',
] as const;

/** The escape hatch, kept out of the arrays so it is always last and always the one with a box. */
const OTHER = 'Other';

export function CancelRide({
  visible,
  bookingId,
  driverAssigned = false,
  onClose,
  onCancelled,
}: CancelRideProps): ReactElement {
  /** The selected row's label, or `null` before anything is chosen. `OTHER` is a valid value. */
  const [selected, setSelected] = useState<string | null>(null);
  /** Only meaningful while `selected === OTHER`. */
  const [typed, setTyped] = useState('');
  /** False on the list, true on the confirmation. Next moves forward; back moves down. */
  const [confirming, setConfirming] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelBooking(bookingId, reason),
    onSuccess: onCancelled,
  });

  /*
   * A screen reopened after a failed attempt must not still be showing the previous error, and one
   * reopened after `Other` must not open with a stale sentence in the box. Keyed on `visible`
   * rather than reset in `onClose` because it can also be dismissed with the hardware back button.
   */
  useEffect(() => {
    if (!visible) {
      cancel.reset();
      setSelected(null);
      setTyped('');
      setConfirming(false);
    }
    // `cancel.reset` is stable across renders; listing the mutation object would re-run this on
    // every state change it makes, including the one that clears the error being cleared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const reasons = driverAssigned ? ASSIGNED_REASONS : SEARCHING_REASONS;
  const busy = cancel.isPending;

  /** What actually goes on the wire. `Other` sends the sentence, never the word "Other". */
  const reason = selected === OTHER ? typed.trim() : (selected ?? '');
  const ready = reason.length > 0;

  /** Back out of the confirmation first, and only leave the screen from the list. */
  function goBack(): void {
    if (busy) return;
    if (confirming) setConfirming(false);
    else onClose();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={goBack}
      // Edge-to-edge, like the app behind it — the keyboard controller measures the keyboard
      // against a window that reaches the screen edges. The screen pads its own insets (above and
      // the footer below), so nothing ends up under the system bars.
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable
            onPress={goBack}
            hitSlop={12}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={confirming ? 'Back to the reasons' : 'Close'}
            style={styles.back}
          >
            <Feather name="arrow-left" size={22} color={colors.fg} />
          </Pressable>
          <Text style={styles.headerTitle}>Cancel Ride?</Text>
          <View style={styles.back} />
        </View>

        <KeyboardAvoidingView
          style={styles.flex}
          // `react-native-keyboard-controller`'s version, `padding` on both platforms: it reads the
          // real keyboard height, where React Native's relied on Android's `adjustResize` — which
          // edge-to-edge (Android 15+) no longer applies, leaving the "Other" box behind the keys.
          behavior="padding"
        >
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {confirming ? (
              <ConfirmStep reason={reason} driverAssigned={driverAssigned} />
            ) : (
              <>
                <Text style={styles.question}>Why do you want to cancel this ride?</Text>
                <View style={styles.rule} />
                <Text style={styles.sectionTitle}>Select Reason</Text>

                {reasons.map((label) => (
                  <ReasonRow
                    key={label}
                    label={label}
                    selected={selected === label}
                    disabled={busy}
                    onPress={() => setSelected(label)}
                  />
                ))}

                <ReasonRow
                  label={OTHER}
                  selected={selected === OTHER}
                  disabled={busy}
                  onPress={() => setSelected(OTHER)}
                />

                {/*
                  THE BOX APPEARS UNDER THE ROW THAT ASKED FOR IT, not on a screen of its own. The
                  customer can still see which option they picked, and changing their mind is one
                  tap up rather than a step back.
                */}
                {selected === OTHER ? (
                  <TextInput
                    value={typed}
                    onChangeText={setTyped}
                    placeholder="Tell us what happened"
                    placeholderTextColor={colors.faint}
                    multiline
                    autoFocus
                    editable={!busy}
                    style={styles.input}
                    accessibilityLabel="Your reason for cancelling"
                    // The box is the last thing on the page, so the keyboard lands right on it.
                    onFocus={() =>
                      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
                    }
                  />
                ) : null}
              </>
            )}

            {cancel.isError ? (
              <Text style={styles.error}>
                {cancel.error instanceof Error ? cancel.error.message : 'Could not cancel this ride.'}
              </Text>
            ) : null}
          </ScrollView>

          {/*
            THE BUTTON STAYS PUT while the list scrolls — a dozen reasons do not fit on a phone,
            and an action that scrolls off the bottom is one the customer has to go looking for.
          */}
          <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
            <PrimaryButton
              label={confirming ? 'Yes, cancel ride' : 'Next'}
              onPress={() => (confirming ? cancel.mutate(reason) : setConfirming(true))}
              loading={busy}
              // Nothing to send until a reason exists — and for `Other`, a chosen row with an
              // empty box is not a reason.
              disabled={!ready}
              showArrow={!confirming}
            />

            {confirming ? (
              <Pressable
                onPress={goBack}
                disabled={busy}
                accessibilityRole="button"
                style={styles.keepLink}
              >
                <Text style={styles.keepLabel}>Keep my ride</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

/**
 * The second step: what was chosen, and what it costs.
 *
 * STATES THAT A FEE IS POSSIBLE RATHER THAN NAMING ONE. The exact figure depends on how far along
 * the driver is, and the real amount comes back on the response — quoting a number here that the
 * server then contradicts would be worse than saying plainly that there may be one.
 */
function ConfirmStep({
  reason,
  driverAssigned,
}: {
  reason: string;
  driverAssigned: boolean;
}): ReactElement {
  return (
    <>
      <Text style={styles.question}>Are you sure?</Text>
      <View style={styles.rule} />

      <Text style={styles.sectionTitle}>Your reason</Text>
      <View style={styles.chosen}>
        <Feather name="message-square" size={16} color={colors.muted} style={styles.chosenIcon} />
        <Text style={styles.chosenText}>{reason}</Text>
      </View>

      <View style={styles.notice}>
        <Feather name="info" size={15} color={colors.muted} style={styles.noticeIcon} />
        <Text style={styles.noticeText}>
          {driverAssigned
            ? 'A driver has already set off for you, so a cancellation fee may apply. We will show you the exact amount once the ride is cancelled.'
            : 'We are still looking for a driver. Cancelling now is usually free, and we will show you any fee once the ride is cancelled.'}
        </Text>
      </View>
    </>
  );
}

/**
 * One reason, as a radio row.
 *
 * A RADIO, NOT A CHECKBOX, and not a button that acts. Exactly one reason goes on the wire, the
 * circle says so before it is tapped, and the row selects rather than submits — which is the
 * whole point of the two-step flow this belongs to.
 */
function ReasonRow({
  label,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
    >
      <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>{label}</Text>
      {/*
        The ring is drawn, not an icon: a filled dot inside a ring is the one shape people read as
        "one of these" without having to try it, and a check glyph reads as "several of these".
      */}
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg, flex: 1, textAlign: 'center' },

  content: { paddingHorizontal: space.lg, paddingBottom: space.lg },

  question: { ...text.title, color: colors.fg, marginTop: space.sm },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.md },
  sectionTitle: {
    ...text.heading,
    fontSize: 16,
    color: colors.fg,
    marginBottom: space.sm,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 56,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    marginBottom: space.sm,
  },
  /*
   * Selection is carried by the ring AND the border, never by colour alone — the ring is the part
   * that survives a colourblind reader and a bright pavement.
   */
  rowSelected: { borderColor: colors.fg, backgroundColor: colors.card },
  rowPressed: { backgroundColor: colors.brandSoft },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { ...text.body, color: colors.fg, flex: 1 },
  rowLabelSelected: { fontFamily: fontFamily.semibold },

  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.fg },
  radioDot: { width: 11, height: 11, borderRadius: radius.pill, backgroundColor: colors.fg },

  input: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    padding: space.md,
    color: colors.fg,
    textAlignVertical: 'top',
    marginTop: space.xs,
    ...text.body,
  },

  chosen: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    padding: space.md,
  },
  chosenIcon: { marginRight: space.sm, marginTop: 1 },
  chosenText: { ...text.body, color: colors.fg, flex: 1 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
  },
  noticeIcon: { marginRight: space.sm, marginTop: 1 },
  noticeText: { ...text.caption, color: colors.fg, flex: 1 },

  error: { ...text.caption, color: colors.danger, marginTop: space.md },

  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  keepLink: { alignSelf: 'center', paddingVertical: space.sm, marginTop: space.xs },
  keepLabel: { ...text.label, color: colors.muted, fontFamily: fontFamily.semibold },
});
