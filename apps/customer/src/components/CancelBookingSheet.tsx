import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { type ReactElement, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { CancelBookingResponse } from '@driverzone/contracts';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { cancelBooking } from '@/lib/api/endpoints/bookings';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface CancelBookingSheetProps {
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
 * The one action that spends money, wherever a booking can still be cancelled from — the trip
 * screen and the driver-search screen both mount this rather than each carrying their own copy.
 *
 * ONE TAP, NOT TWO AND A KEYBOARD. A reason is mandatory (`cancelBooking.usecase.ts` rejects an
 * empty one), which used to mean a text field, a typed sentence and a Confirm button before
 * anything happened. That is the wrong cost for the moment it is asked in: the customer is
 * usually standing somewhere, has already decided, and every extra second is one more second of
 * a driver being sent to a trip nobody wants. So the reasons are BUTTONS and choosing one IS the
 * confirmation — opening the sheet was the "are you sure", and the title says so.
 *
 * `Other` is the escape hatch, and only it costs a keyboard. The presets cover what customers
 * actually cancel for; anything else deserves the free text rather than being squeezed into the
 * nearest wrong option, because this string is what an admin reads afterwards.
 *
 * DOES NOT PREVIEW THE FEE. The ladder (`cancellation.customer_fee_en_route` etc.) is readable
 * from `GET /customer/settings`, and the use case's own comment says the confirm dialog should
 * state it before the customer commits — this does not do that yet, and says so honestly in its
 * copy rather than pretending cancelling is always free. What it does show is the REAL fee and
 * refund the response returns, the moment they exist.
 */

/** Nothing has been dispatched to yet — the wait itself is the usual complaint. */
const SEARCHING_REASONS = [
  'Taking too long to find a driver',
  'Booked by mistake',
  'My plans changed',
  'Fare is too high',
  'Found another ride',
] as const;

/** Someone accepted and is on their way — the complaints are about them, not the search. */
const ASSIGNED_REASONS = [
  'Driver is taking too long',
  'Driver asked me to cancel',
  'Booked by mistake',
  'My plans changed',
  'Found another ride',
] as const;

export function CancelBookingSheet({
  visible,
  bookingId,
  driverAssigned = false,
  onClose,
  onCancelled,
}: CancelBookingSheetProps): ReactElement {
  /** `null` while the preset list is showing; a (possibly empty) string once `Other` is chosen. */
  const [typed, setTyped] = useState<string | null>(null);

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelBooking(bookingId, reason),
    onSuccess: (result) => {
      setTyped(null);
      onCancelled(result);
    },
  });

  /*
   * A sheet reopened after a failed attempt must not still be showing the previous error, and one
   * reopened after `Other` must not open straight into the keyboard step. Keyed on `visible`
   * rather than reset in `onClose` because the sheet can also be dismissed by the backdrop.
   */
  useEffect(() => {
    if (!visible) {
      cancel.reset();
      setTyped(null);
    }
    // `cancel.reset` is stable across renders; listing the mutation object would re-run this on
    // every state change it makes, including the one that sets the error being cleared.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const reasons = driverAssigned ? ASSIGNED_REASONS : SEARCHING_REASONS;
  const busy = cancel.isPending;

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Cancel this trip?</Text>
      <Text style={styles.body}>
        {typed === null
          ? 'Choose a reason and we will cancel it right away. Depending on how far along your driver is, a cancellation fee may apply.'
          : 'Tell us what happened, so we can look into it.'}
      </Text>

      {cancel.isError ? (
        <Text style={styles.error}>
          {cancel.error instanceof Error ? cancel.error.message : 'Could not cancel this trip.'}
        </Text>
      ) : null}

      {typed === null ? (
        <View style={styles.list}>
          {reasons.map((reason) => (
            <ReasonRow
              key={reason}
              label={reason}
              busy={busy}
              // Only the row actually in flight spins. `variables` is the argument the mutation
              // was called with, which is the reason itself.
              loading={busy && cancel.variables === reason}
              onPress={() => cancel.mutate(reason)}
            />
          ))}

          <ReasonRow
            label="Other reason"
            busy={busy}
            loading={false}
            chevron
            onPress={() => setTyped('')}
          />
        </View>
      ) : (
        <>
          <TextInput
            value={typed}
            onChangeText={setTyped}
            placeholder="Tell us why"
            placeholderTextColor={colors.faint}
            multiline
            autoFocus
            editable={!busy}
            style={styles.input}
            accessibilityLabel="Reason for cancelling"
          />

          <PrimaryButton
            label="Cancel this trip"
            onPress={() => cancel.mutate(typed.trim())}
            loading={busy}
            disabled={typed.trim().length === 0}
            showArrow={false}
          />

          <Pressable
            onPress={() => setTyped(null)}
            disabled={busy}
            accessibilityRole="button"
            style={styles.backLink}
          >
            <Text style={styles.backLinkLabel}>Back to the reasons</Text>
          </Pressable>
        </>
      )}
    </BottomSheet>
  );
}

/**
 * One tappable reason. Red text on a plain row rather than five filled red buttons: a stack of
 * solid danger blocks reads as five separate alarms, when the alarm is the decision itself and
 * these are only its wording.
 */
function ReasonRow({
  label,
  busy,
  loading,
  chevron = false,
  onPress,
}: {
  label: string;
  busy: boolean;
  loading: boolean;
  chevron?: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        pressed && !busy && styles.rowPressed,
        // The rows that are not the one being submitted step back rather than vanish, so the
        // sheet does not change shape underneath a thumb that is still on the screen.
        busy && !loading && styles.rowDimmed,
      ]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={colors.danger} />
      ) : chevron ? (
        <Feather name="chevron-right" size={18} color={colors.faint} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { ...text.heading, color: colors.fg, marginBottom: space.xs },
  body: { ...text.body, color: colors.muted, marginBottom: space.md },

  list: { gap: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.card,
  },
  rowPressed: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  rowDimmed: { opacity: 0.45 },
  rowLabel: { ...text.body, color: colors.fg, flex: 1, fontFamily: fontFamily.semibold },

  input: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    padding: space.md,
    color: colors.fg,
    textAlignVertical: 'top',
    marginBottom: space.md,
  },
  backLink: { alignSelf: 'center', paddingVertical: space.sm, marginTop: space.xs },
  backLinkLabel: { ...text.label, color: colors.muted, fontFamily: fontFamily.semibold },

  error: { ...text.caption, color: colors.danger, marginBottom: space.sm },
});
