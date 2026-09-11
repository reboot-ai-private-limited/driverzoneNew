import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BookingDto } from '@driverzone/contracts';
import { requestDayExtension } from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * KEEPING THE DRIVER ONE MORE DAY, on an outstation trip already under way.
 *
 * **It asks; it does not buy.** An extra day commits the driver's next 24 hours, so this opens a
 * request and the driver answers it. The card says so before the tap, and again while it waits —
 * a customer who thought they had bought a day and finds out at midnight that they had not is the
 * failure this wording exists to prevent.
 *
 * **Nothing is charged now, and nothing at all if the answer is no.** An accepted day is added to
 * the bill at the end of the trip alongside any waiting time.
 *
 * **The server decides whether this renders.** `extension.can_extend` is five conditions —
 * started, outstation, has a driver, has a frozen day rate, nothing already pending — and the one
 * function that answers it lives in the API. Re-deriving them here is how a button comes to
 * appear on a trip the server refuses.
 */
export function ExtendDayCard({ booking }: { booking: BookingDto }): ReactElement | null {
  const queryClient = useQueryClient();
  const extension = booking.extension;

  const ask = useMutation({
    mutationFn: () => requestDayExtension(booking.id),
    onSuccess: () => {
      // Re-read rather than patch: the whole `extension` block moves — `can_extend` goes false and
      // `pending` appears — and the server is the thing that decides both.
      void queryClient.invalidateQueries({ queryKey: keys.bookings.detail(booking.id) });
      void queryClient.invalidateQueries({ queryKey: keys.bookings.current() });
    },
  });

  if (extension === null) return null;

  const { pending, extra_days: extraDays } = extension;

  /*
   * Nothing to say: no request outstanding, none already agreed, and the server will not accept
   * one. Rendering a disabled card with a reason on every incity trip would be noise on the one
   * screen a customer watches while a driver is on the way.
   */
  if (pending === null && extraDays === 0 && !extension.can_extend) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Feather name="calendar" size={16} color={colors.fg} />
        <Text style={styles.title}>Need your driver longer?</Text>
      </View>

      {/* Days already agreed, so the customer can see what they have committed to before adding
          another — and what the bill at the end will carry. */}
      {extraDays > 0 ? (
        <Text style={styles.agreed}>
          {extraDays} extra {extraDays === 1 ? 'day' : 'days'} added ·{' '}
          {extension.extra_amount.amount_display}, charged at the end of your trip
        </Text>
      ) : null}

      {pending !== null ? (
        <View style={styles.pendingRow}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={styles.pendingText}>
            Waiting for your driver to confirm {pending.amount.amount_display} for one more day.
            Nothing has been charged.
          </Text>
        </View>
      ) : extension.can_extend ? (
        <>
          <Text style={styles.body}>
            We will ask your driver to stay one more day. If they agree,{' '}
            {extension.price?.amount_display ?? 'one more day'} is added to your bill at the end of
            the trip — nothing is charged now.
          </Text>

          <Pressable
            onPress={() => ask.mutate()}
            disabled={ask.isPending}
            accessibilityRole="button"
            accessibilityLabel="Ask your driver for one more day"
            style={({ pressed }) => [styles.button, (pressed || ask.isPending) && styles.pressed]}
          >
            {ask.isPending ? (
              <ActivityIndicator size="small" color={colors.fg} />
            ) : (
              <Feather name="plus" size={15} color={colors.fg} />
            )}
            <Text style={styles.buttonLabel}>
              Ask for one more day
              {extension.price === null ? '' : ` · ${extension.price.amount_display}`}
            </Text>
          </Pressable>
        </>
      ) : (
        /* The server's own sentence, not one this screen composed — so the reason a customer is
           shown is the reason the endpoint would actually have given. */
        <Text style={styles.body}>{extension.reason}</Text>
      )}

      {ask.isError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {ask.error instanceof Error ? ask.error.message : 'Could not ask your driver just now.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.sm,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },
  body: { ...text.caption, color: colors.muted },
  agreed: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pendingText: { ...text.caption, color: colors.muted, flex: 1 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.fg,
    paddingVertical: space.sm,
    marginTop: space.xs,
  },
  pressed: { opacity: 0.6 },
  buttonLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },
  error: { ...text.caption, color: colors.danger },
});
