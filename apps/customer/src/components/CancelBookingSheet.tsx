import { useMutation } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
import type { CancelBookingResponse } from '@driverzone/contracts';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { cancelBooking } from '@/lib/api/endpoints/bookings';
import { colors, radius, space, text } from '@/theme/theme';

interface CancelBookingSheetProps {
  visible: boolean;
  bookingId: string;
  onClose: () => void;
  onCancelled: (result: CancelBookingResponse) => void;
}

/**
 * The one action that spends money, wherever a booking can still be cancelled from — the trip
 * screen and the driver-search screen both mount this rather than each carrying their own copy.
 * A sheet rather than an inline confirm because a REASON IS MANDATORY
 * (`cancelBooking.usecase.ts`), and there is nowhere honest to put a text field on a bar that is
 * otherwise just a button.
 *
 * DOES NOT PREVIEW THE FEE. The ladder (`cancellation.customer_fee_en_route` etc.) is readable
 * from `GET /customer/settings`, and the use case's own comment says the confirm dialog should
 * state it before the customer commits — this does not do that yet, and says so honestly in its
 * copy rather than pretending cancelling is always free. What it does show is the REAL fee and
 * refund the response returns, the moment they exist.
 */
export function CancelBookingSheet({
  visible,
  bookingId,
  onClose,
  onCancelled,
}: CancelBookingSheetProps): ReactElement {
  const [reason, setReason] = useState('');

  const cancel = useMutation({
    mutationFn: () => cancelBooking(bookingId, reason),
    onSuccess: (result) => {
      setReason('');
      onCancelled(result);
    },
  });

  return (
    <BottomSheet
      visible={visible}
      onClose={() => {
        cancel.reset();
        onClose();
      }}
    >
      <Text style={styles.title}>Cancel this trip?</Text>
      <Text style={styles.body}>
        Depending on how far along your driver is, a cancellation fee may apply — you will see the
        exact amount as soon as this goes through.
      </Text>

      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="Tell us why (required)"
        placeholderTextColor={colors.faint}
        multiline
        style={styles.input}
        accessibilityLabel="Reason for cancelling"
      />

      {cancel.isError ? (
        <Text style={styles.error}>
          {cancel.error instanceof Error ? cancel.error.message : 'Could not cancel this trip.'}
        </Text>
      ) : null}

      <PrimaryButton
        label="Confirm cancellation"
        onPress={() => cancel.mutate()}
        loading={cancel.isPending}
        disabled={reason.trim().length === 0}
        showArrow={false}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...text.heading, color: colors.fg, marginBottom: space.xs },
  body: { ...text.body, color: colors.muted, marginBottom: space.md },
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
  error: { ...text.caption, color: colors.danger, marginBottom: space.sm },
});
