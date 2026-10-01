import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import {
  type ComponentProps,
  type ReactElement,
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  formatPaise,
  initialsOf,
  toTripHistoryRow,
  type TripHistoryRow,
  type TripStatus,
} from '@/features/trips/tripHistory';
import { AppIcon } from '@/components/AppIcon';
import { listTrips } from '@/lib/api/endpoints/trip';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * TRIPS — every job this driver has been given, newest first.
 *
 * **The counterpart to Earnings, and deliberately not a duplicate of it.** Earnings answers "what
 * am I owed?" off the ledger; this answers "what did I drive?" off the bookings. A row here shows
 * the FARE — what was on the meter — and never a driver's share, because `BookingDto` does not
 * carry the split and inventing one would put a second answer about money next to the one a
 * payout is checked against.
 *
 * **Refetched on focus, not polled.** A driver's history changes when they finish or lose a trip,
 * and both of those happen on the trip screen in this same app — so returning to this tab is
 * exactly when it can be stale, and the only time it can be. The live trip screen keeps its own
 * poll; a history does not need one.
 *
 * Filters, search and sort are CLIENT-SIDE over the server-capped list, matching the customer
 * app's ride history for the reason its header gives: paging under a client-side filter would
 * silently hide matches on page two.
 */

type Filter = 'TODAY' | 'THIS_MONTH' | TripStatus;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'RUNNING', label: 'Live' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_COPY: Record<TripStatus, { label: string; color: string; tint: string }> = {
  COMPLETED: { label: 'Completed', color: colors.dutyOn, tint: colors.dutyOnBg },
  CANCELLED: { label: 'Cancelled', color: colors.danger, tint: '#FDEEF0' },
  RUNNING: { label: 'Live', color: colors.link, tint: '#EAF1FD' },
};

export default function TripsScreen(): ReactElement {
  const [filter, setFilter] = useState<Filter | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const history = useQuery({
    queryKey: keys.trip.list(),
    queryFn: ({ signal }) => listTrips(signal),
    select: (response) => response.bookings.map(toTripHistoryRow),
  });

  useFocusEffect(
    useCallback(() => {
      void history.refetch();
      // `refetch` is stable for a given key; depending on the whole query object would re-run this
      // on every status change it makes, including the refetch's own.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const all = useMemo(() => history.data ?? [], [history.data]);

  const trips = useMemo(() => {
    let list = [...all];

    if (filter === 'COMPLETED' || filter === 'CANCELLED' || filter === 'RUNNING') {
      list = list.filter((trip) => trip.status === filter);
    }

    if (filter === 'TODAY' || filter === 'THIS_MONTH') {
      const now = new Date();
      list = list.filter((trip) => {
        const at = new Date(trip.at);
        const sameMonth = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
        return filter === 'THIS_MONTH' ? sameMonth : sameMonth && at.getDate() === now.getDate();
      });
    }

    const needle = query.trim().toLowerCase();
    if (needle.length > 0) {
      // `reference` is what a driver can actually read off a row; the booking id is a Mongo
      // ObjectId they have never seen and could not type.
      list = list.filter(
        (trip) =>
          trip.reference.toLowerCase().includes(needle) ||
          (trip.customerName?.toLowerCase().includes(needle) ?? false) ||
          trip.pickup.toLowerCase().includes(needle) ||
          trip.drop.toLowerCase().includes(needle),
      );
    }

    return list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [all, filter, query]);

  /*
   * OVER THE WHOLE HISTORY, never the filtered view — "Trips" that dropped to 2 because a chip is
   * on would be a different statistic wearing the same label.
   *
   * Fares count COMPLETED trips only: a cancelled trip may have carried a fee, but that fee is a
   * ledger row rather than this trip's fare, and adding fares for trips that never ran would
   * overstate the meter.
   */
  const stats = useMemo(() => {
    const completed = all.filter((trip) => trip.status === 'COMPLETED');
    return {
      total: all.length,
      completed: completed.length,
      faresPaise: completed.reduce((sum, trip) => sum + trip.totalPaise, 0),
    };
  }, [all]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View style={styles.flex}>
            <Text style={styles.headerTitle}>Your trips</Text>
            <Text style={styles.headerSubtitle}>
              {history.isPending
                ? 'Loading…'
                : `${String(stats.total)} ${stats.total === 1 ? 'trip' : 'trips'} so far`}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setSearching((open) => !open);
              if (searching) setQuery('');
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={searching ? 'Close search' : 'Search trips'}
            style={({ pressed }) => [styles.headerIcon, pressed && styles.pressed]}
          >
            <Feather name={searching ? 'x' : 'search'} size={19} color={colors.fg} />
          </Pressable>
        </View>
      </View>

      {searching ? (
        <Animated.View entering={FadeInDown.duration(180)} style={styles.searchBox}>
          <Feather name="search" size={16} color={colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Trip ID, customer or place"
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
            autoFocus
            accessibilityLabel="Search trips"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button">
              <Feather name="x" size={16} color={colors.faint} />
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        // Pull-to-refresh: this is the screen a driver opens at the end of a shift to check a trip
        // landed, and that question deserves to be askable directly.
        refreshControl={
          <RefreshControl
            refreshing={history.isRefetching && !history.isPending}
            onRefresh={() => void history.refetch()}
            tintColor={colors.muted}
          />
        }
      >
        <View style={styles.statsRow}>
          <StatTile
            icon="check-circle"
            label="Completed"
            value={String(stats.completed)}
            tone="good"
          />
          <StatTile icon="tag" label="Fares driven" value={formatPaise(stats.faresPaise)} />
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {FILTERS.map((option) => {
            const active = filter === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setFilter(active ? null : option.value)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.chip,
                  active && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {history.isPending ? (
          <View style={styles.centred}>
            <ActivityIndicator size="large" color={colors.fg} />
          </View>
        ) : history.isError ? (
          <View style={styles.centred}>
            <View style={styles.emptyIcon}>
              <Feather name="wifi-off" size={24} color={colors.muted} />
            </View>
            <Text style={styles.emptyTitle}>Could not load your trips</Text>
            <Text style={styles.emptyBody}>
              {history.error instanceof Error
                ? history.error.message
                : 'Check your connection and try again.'}
            </Text>
            <Pressable
              onPress={() => void history.refetch()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
            >
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : trips.length === 0 ? (
          <View style={styles.centred}>
            <View style={styles.emptyIcon}>
              <Feather name="inbox" size={24} color={colors.muted} />
            </View>
            {/*
              TWO DIFFERENT EMPTIES. "No trips yet" is a new driver; "nothing matches" is a filter
              they can undo — pointing a first-week driver at a filter would blame the wrong thing.
            */}
            <Text style={styles.emptyTitle}>
              {all.length === 0 ? 'No trips yet' : 'Nothing matches'}
            </Text>
            <Text style={styles.emptyBody}>
              {all.length === 0
                ? 'Go on duty and accept an offer — every trip you drive shows up here.'
                : 'Try a different filter or search.'}
            </Text>
          </View>
        ) : (
          trips.map((trip, index) => (
            <Animated.View
              key={trip.id}
              entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(220)}
            >
              <TripCard trip={trip} />
            </Animated.View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: FeatherName;
  label: string;
  value: string;
  tone?: 'default' | 'good';
}): ReactElement {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, tone === 'good' && styles.statIconGood]}>
        <Feather name={icon} size={15} color={tone === 'good' ? colors.dutyOn : colors.fg} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function TripCard({ trip }: { trip: TripHistoryRow }): ReactElement {
  const status = STATUS_COPY[trip.status];

  return (
    <Pressable
      onPress={() => router.push(`/trips/${trip.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Trip ${trip.reference}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.cardTop}>
        {/*
          The customer's INITIALS rather than a photo. No account carries one, and a generic
          silhouette on every row would be a column of identical grey circles telling a driver
          nothing — initials at least distinguish one trip from the next at a glance.
        */}
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsOf(trip.customerName)}</Text>
        </View>

        <View style={styles.flex}>
          <Text style={styles.customerName} numberOfLines={1}>
            {trip.customerName ?? 'Customer'}
          </Text>
          <Text style={styles.reference} numberOfLines={1}>
            {trip.reference} · {formatWhen(trip.at)}
          </Text>
        </View>

        <View style={[styles.statusPill, { backgroundColor: status.tint }]}>
          <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      {/*
        A connecting line between the two dots, not two stacked lines of text — it says these
        points belong to ONE trip, the same reading the trip screen's waypoint card gives.
      */}
      <View style={styles.route}>
        <View style={styles.routeMarkers}>
          <View style={styles.dotPickup} />
          <View style={styles.routeLine} />
          <View style={styles.dotDrop} />
        </View>
        <View style={styles.routeText}>
          <Text style={styles.place} numberOfLines={1}>
            {trip.pickup}
          </Text>
          <Text style={styles.place} numberOfLines={1}>
            {trip.drop}
          </Text>
        </View>
      </View>

      <View style={styles.cardFooter}>
        <View style={styles.payMode}>
          <AppIcon
            name={trip.isCash ? 'rupee' : 'smartphone'}
            size={12}
            color={colors.muted}
          />
          <Text style={styles.payModeLabel}>{trip.paymentLabel}</Text>
        </View>
        <Text style={styles.fare}>{trip.totalDisplay}</Text>
        <Feather name="chevron-right" size={16} color={colors.faint} />
      </View>
    </Pressable>
  );
}

/** Today and yesterday by name — a shift is read relative to the one just worked. */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  const today = new Date();
  const sameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();
  if (sameDay(at, today)) return `Today, ${time}`;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(at, yesterday)) return `Yesterday, ${time}`;

  return `${at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },

  header: { backgroundColor: colors.brand, paddingHorizontal: space.lg, paddingVertical: space.lg },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { ...text.title, color: colors.fg },
  headerSubtitle: { ...text.caption, color: colors.fg, opacity: 0.7, marginTop: 1 },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.md,
    paddingHorizontal: space.md,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  searchInput: { ...text.body, color: colors.fg, flex: 1, padding: 0 },

  scroll: { padding: space.lg, paddingBottom: space.xl },

  statsRow: { flexDirection: 'row', gap: space.sm },
  statTile: {
    flex: 1,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.md,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  statIconGood: { backgroundColor: colors.dutyOnBg },
  statValue: { ...text.heading, color: colors.fg },
  statLabel: { ...text.caption, color: colors.muted, marginTop: 1 },

  chipsRow: { gap: space.sm, paddingVertical: space.md },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  // A dark edge on the active chip, not just a tint: yellow alone is ~1.1:1 against white and
  // disappears in bright light — the same rule the rest of the app follows.
  chipActive: { backgroundColor: colors.brand, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted },
  chipLabelActive: { color: colors.fg, fontFamily: fontFamily.bold },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.sm,
    ...shadow.soft,
  },
  cardPressed: { backgroundColor: colors.bgSunken },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  avatarText: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  customerName: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  reference: { ...text.caption, color: colors.faint, marginTop: 1 },
  statusPill: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusLabel: { ...text.caption, fontFamily: fontFamily.semibold, fontSize: 11 },

  route: { flexDirection: 'row', marginTop: space.md },
  routeMarkers: { alignItems: 'center', width: 8, marginRight: space.sm },
  dotPickup: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.dutyOn },
  dotDrop: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  routeLine: { width: 1, flex: 1, minHeight: 16, backgroundColor: colors.border },
  routeText: { flex: 1, justifyContent: 'space-between', gap: space.xs },
  place: { ...text.caption, color: colors.muted },

  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingTop: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  payMode: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  payModeLabel: { ...text.caption, color: colors.muted },
  fare: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },

  centred: { alignItems: 'center', paddingVertical: space.xl },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  emptyTitle: { ...text.heading, color: colors.fg },
  emptyBody: {
    ...text.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xs,
    paddingHorizontal: space.lg,
  },
  retry: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
  },
  retryLabel: { ...text.label, color: colors.brandOnFg },
});
