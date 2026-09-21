import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatWhen } from '@/features/trips/scheduledWhen';
import {
  acceptScheduledBooking,
  listScheduledBoard,
} from '@/lib/api/endpoints/scheduledBoard';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

/**
 * TRIPS NOBODY TOOK — the scheduled board.
 *
 * A scheduled booking is rung for the moment it is made. When nobody answers it is parked rather
 * than given up on, and it waits here until a driver takes it, ops assigns one, or the final ring
 * ninety minutes before the pickup (docs/LLD/dispatch-and-assignment.md §Ring early, park, ring
 * again).
 *
 * **THIS SCREEN IS THE OPPOSITE OF THE RING SCREEN, deliberately.** That one takes over the phone,
 * counts down in seconds and costs the driver their acceptance rate if they ignore it. This one is
 * a list: nothing is ringing, nothing expires while they read it, and scrolling past a trip costs
 * them nothing. That difference is what makes it fair to show a 6 am trip at 9 pm — the thing
 * dispatch is otherwise careful never to do, because a driver rung at 9 pm does not know their
 * morning yet. Given the choice rather than the interruption, they can answer for themselves.
 *
 * Every row here is one the SERVER has already confirmed this driver can take: competent for the
 * vehicle, and free of any trip they already hold. A row that would be refused on tap is worse
 * than a row that is not shown.
 */
export default function ScheduledBoardScreen(): ReactElement {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<string | null>(null);

  const board = useQuery({
    queryKey: keys.scheduledBoard.list(),
    queryFn: ({ signal }) => listScheduledBoard(signal),
    /*
     * No `refetchInterval`. Nothing here is time-critical the way an offer is — these trips are
     * hours or days out, and a list that reshuffled under a driver's thumb while they were
     * reading it would be worse than one that is a minute stale. Pull to refresh is the list
     * changing when they ask it to.
     */
    staleTime: 30_000,
  });

  const take = useMutation({
    mutationFn: (bookingId: string) => acceptScheduledBooking(bookingId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: keys.scheduledBoard.all() });

      if (!result.claimed) {
        /*
         * SOMEBODY ELSE GOT THERE FIRST, or it clashes with a trip they hold. Neither is an error
         * and neither is the driver's fault — the server's own wording is shown, because "another
         * driver took it" and "this clashes with DZ-… you already have" are completely different
         * news to a person and identical to a state machine.
         */
        setOutcome(result.message);
        return;
      }

      // Straight to the trip they now hold — `replace`, so Back does not return to a board row
      // for a booking that is no longer on it.
      router.replace(`/trip/${result.booking_id}`);
    },
    onError: (cause) => {
      setOutcome(cause instanceof Error ? cause.message : 'Could not take this trip.');
    },
  });

  const bookings = board.data?.bookings ?? [];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Trips you can take</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Booked ahead, and nobody has taken them yet. Nothing here is ringing — take one if it
          suits your day.
        </Text>

        {outcome === null ? null : (
          <View style={styles.notice}>
            <Feather name="info" size={14} color={colors.muted} />
            <Text style={styles.noticeText}>{outcome}</Text>
          </View>
        )}

        {board.isPending ? (
          <View style={styles.centre}>
            <ActivityIndicator size="large" color={colors.fg} />
          </View>
        ) : board.isError ? (
          <View style={styles.centre}>
            <Text style={styles.empty}>Could not load these right now.</Text>
            <Pressable onPress={() => void board.refetch()} accessibilityRole="button">
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          </View>
        ) : bookings.length === 0 ? (
          <View style={styles.centre}>
            <Feather name="calendar" size={28} color={colors.faint} />
            <Text style={styles.empty}>
              No trips waiting right now. New ones appear here when a booking made for later has
              not found a driver.
            </Text>
          </View>
        ) : (
          bookings.map((booking) => (
            <View key={booking.booking_id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.when}>{formatWhen(booking.scheduled_at)}</Text>
                <Text style={styles.earning}>{booking.earning.amount_display}</Text>
              </View>

              <Text style={styles.reference}>{booking.reference}</Text>

              <View style={styles.leg}>
                <Feather name="map-pin" size={13} color={colors.dutyOn} />
                <Text style={styles.legText} numberOfLines={2}>
                  {booking.pickup.address}
                </Text>
              </View>
              <View style={styles.leg}>
                <Feather name="flag" size={13} color={colors.muted} />
                <Text style={styles.legText} numberOfLines={2}>
                  {booking.drop.address}
                </Text>
              </View>

              {/*
                THE APP'S OWN PRIMARY BUTTON, not a local one.

                It was a local `Pressable` with `backgroundColor: colors.brand` and
                `color: colors.brandOnFg` — and those two are nearly the same yellow. `brandOnFg`
                is the brand colour FOR USE ON `fg`, which is what its name says and what
                `PrimaryButton` does with it: black fill, yellow label. Painting it onto the yellow
                fill instead produced #F5E500 text on #F2F200, invisible at arm's length in a car.

                Using the component removes the whole class of mistake — and carries the 56dp tap
                target, the lift-on-press and the real `disabled` behaviour with it.
              */}
              <View style={styles.takeButton}>
                <PrimaryButton
                  label={
                    take.isPending && take.variables === booking.booking_id
                      ? 'Taking…'
                      : 'Take this trip'
                  }
                  onPress={() => {
                    setOutcome(null);
                    take.mutate(booking.booking_id);
                  }}
                  loading={take.isPending && take.variables === booking.booking_id}
                  disabled={take.isPending}
                  showArrow={false}
                />
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg, flex: 1, textAlign: 'center' },

  content: { padding: space.lg, gap: space.sm },
  intro: { ...text.body, color: colors.muted, marginBottom: space.xs },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    backgroundColor: colors.bgSunken,
    borderRadius: 8,
    padding: space.sm,
  },
  noticeText: { ...text.caption, color: colors.muted, flex: 1 },

  centre: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl * 2 },
  empty: { ...text.body, color: colors.muted, textAlign: 'center' },
  retry: { ...text.body, color: colors.link },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.xs,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  when: { ...text.label, color: colors.fg },
  earning: { ...text.heading, color: colors.fg },
  reference: { ...text.caption, color: colors.faint, marginBottom: space.xs },

  leg: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  legText: { ...text.caption, color: colors.muted, flex: 1 },

  /** Spacing only — the button brings its own fill, height and pressed state. */
  takeButton: { marginTop: space.sm },
});
