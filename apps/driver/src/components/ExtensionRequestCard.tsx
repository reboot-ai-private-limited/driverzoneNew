import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BookingDto } from '@driverzone/contracts';
import { respondToExtension } from '@/lib/api/endpoints/trip';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * THE CUSTOMER HAS ASKED THIS DRIVER TO STAY ONE MORE DAY.
 *
 * **A card, not a ringing screen.** A dispatch offer interrupts a driver who is waiting for work
 * and has 45 seconds to answer. This reaches a driver who is mid-trip and is very often being
 * asked face to face by the customer sitting behind them — a full-screen countdown would be a
 * worse version of a conversation already happening.
 *
 * **Both answers are free.** Declining costs the driver nothing and does not touch their
 * acceptance rate; so does letting it lapse. That is said on the card, because a driver who has
 * learned what declining an OFFER costs has no reason to assume this is different.
 *
 * **What they earn is shown before they agree**, not after. Accepting commits their next 24
 * hours, and a driver deciding that is owed the number.
 */
export function ExtensionRequestCard({ booking }: { booking: BookingDto }): ReactElement | null {
  const queryClient = useQueryClient();
  const pending = booking.extension?.pending ?? null;

  const answer = useMutation({
    mutationFn: (accept: boolean) => respondToExtension(booking.id, accept),
    onSuccess: () => {
      // Re-read: accepting moves the whole block — `pending` clears and `extra_days` rises — and
      // the server owns both.
      void queryClient.invalidateQueries({ queryKey: keys.trip.detail(booking.id) });
      void queryClient.invalidateQueries({ queryKey: keys.trip.current() });
    },
  });

  // Only ever rendered for a request actually waiting on this driver. Days already agreed are
  // shown on the fare, not here — this card is a question, and an answered one is not.
  if (pending === null) return null;

  /*
   * The server sends this only on a DRIVER's read of their own trip — a customer looking at the
   * same booking gets `null`, because the split is not theirs to see. Null here would mean this
   * card is rendering against a customer-shaped response, which is a wiring bug rather than a
   * state to design for: better to show nothing than to ask a driver to commit a day without
   * saying what it pays.
   */
  const earning = pending.driver_amount;
  if (earning === null) return null;

  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <Feather name="calendar" size={16} color={colors.fg} />
        <Text style={styles.title}>Your customer wants one more day</Text>
      </View>

      <Text style={styles.body}>
        They have asked you to stay an extra day on this trip. You earn{' '}
        <Text style={styles.amount}>{earning.amount_display}</Text> for it, paid with the rest of
        this trip when you complete it.
      </Text>

      <View style={styles.actions}>
        <Pressable
          onPress={() => answer.mutate(false)}
          disabled={answer.isPending}
          accessibilityRole="button"
          accessibilityLabel="Decline the extra day"
          style={({ pressed }) => [styles.decline, pressed && styles.pressed]}
        >
          <Text style={styles.declineLabel}>Can&apos;t stay</Text>
        </Pressable>

        <Pressable
          onPress={() => answer.mutate(true)}
          disabled={answer.isPending}
          accessibilityRole="button"
          accessibilityLabel={`Accept the extra day for ${earning.amount_display}`}
          style={({ pressed }) => [styles.accept, pressed && styles.pressed]}
        >
          {answer.isPending ? (
            <ActivityIndicator size="small" color={colors.onFg} />
          ) : (
            <Text style={styles.acceptLabel}>Yes, I can stay</Text>
          )}
        </Pressable>
      </View>

      {/* Said out loud, because a driver who knows what declining an OFFER costs has no reason to
          assume this one is free. */}
      <Text style={styles.note}>Saying no costs you nothing and is not held against you.</Text>

      {answer.isError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {answer.error instanceof Error
            ? answer.error.message
            : 'Could not send your answer just now.'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.dutyOnBg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.dutyOn,
    padding: space.lg,
    gap: space.sm,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  title: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold, flex: 1 },
  body: { ...text.caption, color: colors.fg },
  amount: { fontFamily: fontFamily.bold },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  decline: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
  },
  declineLabel: { ...text.label, color: colors.muted, fontFamily: fontFamily.semibold },
  accept: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
  },
  acceptLabel: { ...text.label, color: colors.onFg, fontFamily: fontFamily.semibold },
  pressed: { opacity: 0.6 },
  note: { ...text.caption, color: colors.muted },
  error: { ...text.caption, color: colors.danger },
});
