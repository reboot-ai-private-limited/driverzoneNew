import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
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
import { BottomSheet } from '@/components/BottomSheet';
import {
  toRideHistoryRow,
  type RideHistoryRow,
  type RideStatus,
} from '@/features/rides/rideHistory';
import { rebookParamsForPoints } from '@/features/booking/rebook';
import { listBookings } from '@/lib/api/endpoints/bookings';
import { formatPaise } from '@/lib/money';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * Ride history — this customer's real bookings, newest first.
 *
 * WAS DEMO DATA UNTIL `GET /customer/bookings` EXISTED. The whole screen ran off `demoRides.ts`
 * behind a "not a real ride" badge, because the API had a single-booking read and no list. The
 * list endpoint shipped, so the badge, the fixture and every invented field are gone — see
 * `rideHistory.ts` on which fields had no honest source and were dropped rather than faked.
 *
 * FILTERS, SEARCH AND SORT STAY CLIENT-SIDE, over the (server-capped) history. They were always
 * real logic applied to fake rows; now they are real logic applied to real ones. Moving them to
 * the server is the same change that adds pagination, and neither is worth doing before a
 * customer's history outgrows one response.
 */

type Filter = 'TODAY' | 'THIS_MONTH' | RideStatus;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'SCHEDULED', label: 'Scheduled' },
];

type SortOrder = 'NEWEST' | 'AMOUNT_DESC';

export default function RidesScreen(): ReactElement {
  const [filter, setFilter] = useState<Filter | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sortSheet, setSortSheet] = useState(false);
  const [sort, setSort] = useState<SortOrder>('NEWEST');

  /*
   * REFETCHED ON FOCUS, not polled. History changes only when the customer does something —
   * finishes a trip, cancels one — and both of those happen on another screen in this same app,
   * so coming back to this tab is exactly when it can be stale and the only time it can be.
   */
  const history = useQuery({
    queryKey: keys.bookings.list(),
    queryFn: listBookings,
    select: (response) => response.bookings.map(toRideHistoryRow),
  });

  /*
   * The FIRST focus is skipped: the query is already fetching because the screen just mounted,
   * and refetching on top of it was a second identical request on every first visit.
   */
  const focusedBefore = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedBefore.current) {
        focusedBefore.current = true;
        return;
      }
      void history.refetch();
      // `refetch` is stable for a given query key; depending on the whole query object would
      // re-run this on every status change it makes, including the refetch's own.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  /*
   * The pull-to-refresh spinner shows ONLY for a pull. It used to follow `isRefetching`, which is
   * also true for the silent refetch above — so every return to this tab flashed a spinner over a
   * list that was already on screen and correct. A background refresh swaps the rows in quietly.
   */
  const [pulling, setPulling] = useState(false);
  const pullToRefresh = useCallback(() => {
    setPulling(true);
    void history.refetch().finally(() => setPulling(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const all = useMemo(() => history.data ?? [], [history.data]);

  const rides = useMemo(() => {
    let list = [...all];

    if (
      filter === 'COMPLETED' ||
      filter === 'CANCELLED' ||
      filter === 'RUNNING' ||
      filter === 'SCHEDULED'
    ) {
      list = list.filter((ride) => ride.status === filter);
    }
    // Both read `at` — when the trip actually happened, not when it was booked. See
    // `rideHappenedAt`: a trip completed at 9pm belongs under today even if it was scheduled
    // yesterday, and a still-searching one falls back to its scheduled time.
    if (filter === 'TODAY' || filter === 'THIS_MONTH') {
      const now = new Date();
      list = list.filter((ride) => {
        const at = new Date(ride.at);
        if (filter === 'TODAY') {
          return (
            at.getFullYear() === now.getFullYear() &&
            at.getMonth() === now.getMonth() &&
            at.getDate() === now.getDate()
          );
        }
        return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
      });
    }

    const needle = query.trim().toLowerCase();
    if (needle.length > 0) {
      // `reference` is what the customer can actually read off a row; the booking id is a Mongo
      // ObjectId they have never seen and could not type.
      list = list.filter(
        (ride) =>
          ride.reference.toLowerCase().includes(needle) ||
          (ride.driverName?.toLowerCase().includes(needle) ?? false) ||
          ride.pickup.toLowerCase().includes(needle) ||
          ride.drop.toLowerCase().includes(needle),
      );
    }

    list.sort((a, b) =>
      sort === 'NEWEST' ? Date.parse(b.at) - Date.parse(a.at) : b.totalPaise - a.totalPaise,
    );

    return list;
  }, [all, filter, query, sort]);

  /*
   * OVER THE WHOLE HISTORY, never the filtered view. "Total Trips" that dropped to 2 because a
   * filter chip is on would be a different statistic wearing the same label.
   *
   * Spend counts COMPLETED trips only: a cancelled ride may still have cost a fee, but that fee
   * is a charge row, not this trip's fare, and adding fares for trips that never happened would
   * overstate what the customer has spent.
   */
  const stats = useMemo(() => {
    // `paidPaise`, not `totalPaise` — money that left the customer, so a trip wallet credit
    // reduced counts for what they actually handed over.
    const totalSpent = all
      .filter((ride) => ride.status === 'COMPLETED')
      .reduce((sum, ride) => sum + ride.paidPaise, 0);

    return { total: all.length, totalSpent };
  }, [all]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Ride History</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => setSearching((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Search rides"
            style={styles.headerIcon}
          >
            <Feather name="search" size={20} color={colors.fg} />
          </Pressable>
          <Pressable
            onPress={() => setSortSheet(true)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Sort rides"
            style={styles.headerIcon}
          >
            <Feather name="sliders" size={20} color={colors.fg} />
          </Pressable>
        </View>
      </View>

      {searching ? (
        <Animated.View entering={FadeInDown.duration(180)} style={styles.searchBox}>
          <Feather name="search" size={16} color={colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by booking ID, driver or place"
            placeholderTextColor={colors.faint}
            style={styles.searchInput}
            autoFocus
            accessibilityLabel="Search rides"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Feather name="x" size={16} color={colors.faint} />
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        // Pull-to-refresh, because this is a list a customer will reach for after a trip ends and
        // "did my last ride land?" deserves an answer they can ask for directly.
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={pullToRefresh}
            tintColor={colors.muted}
          />
        }
      >
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
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.statsGrid}>
          {/*
            Plain Views, NOT `Stagger`. The entering animation on the first tile (no delay) froze
            part-way on Android and left "Total Trips" pushed down over the first ride card for
            good. These are the screen's static header, already in place the moment it opens —
            there is nothing for them to animate into.
          */}
          <View style={styles.statTileWrap}>
            <StatTile icon="headphones" label="Total Trips" value={String(stats.total)} />
          </View>
          <View style={styles.statTileWrap}>
            <StatTile
              icon="credit-card"
              label="Total Spent"
              value={formatPaise(stats.totalSpent)}
            />
          </View>
        </View>

        {history.isPending ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : history.isError ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="wifi-off" size={22} color={colors.muted} />
            </View>
            <Text style={styles.emptyText}>
              {history.error instanceof Error
                ? history.error.message
                : 'We could not load your rides.'}
            </Text>
            <Pressable
              onPress={() => void history.refetch()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            >
              <Feather name="refresh-cw" size={14} color={colors.fg} />
              <Text style={styles.retryLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : rides.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="inbox" size={22} color={colors.muted} />
            </View>
            {/*
              TWO DIFFERENT EMPTIES. "No rides yet" is a new customer and "nothing matches" is a
              filter they can undo — telling a first-time customer their filter found nothing
              would point them at a control that is not the problem.
            */}
            <Text style={styles.emptyText}>
              {all.length === 0
                ? 'No rides yet. Your trips will show up here.'
                : 'No rides match this filter.'}
            </Text>
          </View>
        ) : (
          rides.map((ride, index) => (
            <Stagger key={ride.id} index={index + 2}>
              <RideRow ride={ride} />
            </Stagger>
          ))
        )}
      </ScrollView>

      <BottomSheet visible={sortSheet} onClose={() => setSortSheet(false)}>
        <Text style={styles.sheetTitle}>Sort by</Text>
        {[
          { value: 'NEWEST' as const, label: 'Newest first' },
          { value: 'AMOUNT_DESC' as const, label: 'Amount — high to low' },
        ].map((option) => (
          <Pressable
            key={option.value}
            onPress={() => {
              setSort(option.value);
              setSortSheet(false);
            }}
            accessibilityRole="button"
            style={styles.sortOption}
          >
            <Text style={styles.sortOptionLabel}>{option.label}</Text>
            {sort === option.value ? <Feather name="check" size={18} color={colors.fg} /> : null}
          </Pressable>
        ))}
      </BottomSheet>
    </View>
  );
}

/** A staggered rise on first paint, top to bottom — the stat row, then each ride card in turn. */
function Stagger({
  index,
  style,
  children,
}: {
  index: number;
  style?: object;
  children: ReactNode;
}): ReactElement {
  return (
    <Animated.View entering={FadeInDown.delay(index * 50).duration(200)} style={style}>
      {children}
    </Animated.View>
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
  tone?: 'default' | 'good' | 'bad';
}): ReactElement {
  return (
    <View style={styles.statTile}>
      <View style={styles.statTopRow}>
        <View
          style={[
            styles.statIcon,
            tone === 'good' && styles.statIconGood,
            tone === 'bad' && styles.statIconBad,
          ]}
        >
          <Feather
            name={icon}
            size={16}
            color={tone === 'good' ? colors.success : tone === 'bad' ? colors.danger : colors.fg}
          />
        </View>
        <Text style={styles.statValue}>{value}</Text>
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * `SCHEDULED` is amber rather than the blue `RUNNING` wears, because the two used to be the same
 * pill: a trip booked for next Tuesday read as a driver on the way. Blue is "happening"; this is
 * "booked, nothing happening yet".
 */
const STATUS_COPY: Record<RideStatus, { label: string; color: string; tint: string }> = {
  COMPLETED: { label: 'Completed', color: colors.success, tint: '#E7F5EC' },
  CANCELLED: { label: 'Cancelled', color: colors.danger, tint: '#FDECEC' },
  RUNNING: { label: 'Running', color: colors.link, tint: '#E9F0FC' },
  SCHEDULED: { label: 'Scheduled', color: '#7A5E00', tint: '#FAF3D2' },
};

function RideRow({ ride }: { ride: RideHistoryRow }): ReactElement {
  const statusCopy = STATUS_COPY[ride.status];
  const when = new Date(ride.at);
  const dateLabel = `${String(when.getDate()).padStart(2, '0')} ${MONTHS[when.getMonth()]} ${String(
    when.getFullYear(),
  )}, ${formatClock(when)}`;

  return (
    <Pressable
      /*
       * WHERE A ROW LEADS DEPENDS ON WHETHER THE TRIP IS OVER.
       *
       * `/rides/[id]` is a receipt and says so in its own header: no polling, no actions. That is
       * right for a finished trip and a dead end for one that has not happened — a customer who
       * wanted to cancel a booking made for next week landed there and found nothing to press,
       * because every cancel affordance lives on the trip screen. So a live or upcoming booking
       * goes there instead, where the status is current and Cancel exists.
       */
      onPress={() => router.push(ride.finished ? `/rides/${ride.id}` : `/trip/${ride.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.rideCard, pressed && styles.rideCardPressed]}
    >
      <View style={styles.rideIcon}>
        <Feather name="truck" size={18} color={colors.fg} />
      </View>

      <View style={styles.flex}>
        <View style={styles.rideTopRow}>
          <Text style={styles.rideId} numberOfLines={1}>
            {ride.reference}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: statusCopy.tint }]}>
            <Text style={[styles.rideStatus, { color: statusCopy.color }]}>{statusCopy.label}</Text>
          </View>
        </View>
        <Text style={styles.rideDate}>{dateLabel}</Text>

        {/*
          NO RATING BESIDE THE NAME. The demo rows carried one; `BookingDto.driver` is `{ id,
          name }` and nothing more, so the star went rather than being filled with a constant.
          The row itself stays even with no driver yet — a trip still searching has a name-shaped
          gap, and collapsing it would make searching rows a different height from every other.
        */}
        <View style={styles.rideDriverRow}>
          <Text style={styles.rideDriver} numberOfLines={1}>
            {ride.driverName ?? 'Driver not assigned yet'}
          </Text>
        </View>

        {/*
          A short connecting line between the two dots — the same reading `MapCanvas`'s dashed
          route line gives the map: it says these two points belong to ONE trip, not two
          unrelated lines of text that happen to sit on top of each other.
        */}
        <View style={styles.rideRoute}>
          <View style={styles.rideRouteMarkers}>
            <View style={styles.ridePlaceDotPickup} />
            <View style={styles.rideRouteLine} />
            <View style={styles.ridePlaceDotDrop} />
          </View>
          <View style={styles.rideRouteText}>
            <Text style={styles.ridePlace} numberOfLines={1}>
              {ride.pickup}
            </Text>
            <Text style={styles.ridePlace} numberOfLines={1}>
              {ride.drop}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.rideRight}>
        <Text style={styles.ridePrice}>{ride.totalDisplay}</Text>
        <Feather name="chevron-right" size={16} color={colors.faint} />

        {/*
          BOOK AGAIN, INSIDE THE ROW'S OWN PRESSABLE. `Pressable` nests, and the inner one wins —
          so this takes the tap without also opening the detail screen behind it. Hidden on any
          trip still ahead of the customer: rebooking the ride you are sitting in is not a thing to
          offer, and neither is booking a second copy of one you have already booked for Tuesday.
        */}
        {ride.finished ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/home',
                params: rebookParamsForPoints(ride.pickupPoint, ride.dropPoint),
              })
            }
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Book this trip again, ${ride.pickup} to ${ride.drop}`}
            style={({ pressed }) => [styles.rebookChip, pressed && styles.rebookChipPressed]}
          >
            <Feather name="repeat" size={12} color={colors.fg} />
            <Text style={styles.rebookChipLabel}>Book again</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatClock(at: Date): string {
  const hours = at.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} ${suffix}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  title: { ...text.title, color: colors.fg },
  headerActions: { flexDirection: 'row', gap: space.sm },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },

  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryPressed: { backgroundColor: colors.bgSunken },
  retryLabel: { ...text.label, color: colors.fg },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  searchInput: { ...text.body, color: colors.fg, flex: 1, padding: 0 },

  scrollContent: { paddingBottom: space.xl },

  chipsRow: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  // A dark edge on the active chip, not just a tint — the same rule `SavedPlaceRow`'s selected
  // state follows: yellow alone is a ~1.1:1 surface against white and disappears in bright light.
  chipActive: { backgroundColor: colors.brand, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted },
  chipLabelActive: { color: colors.fg, fontFamily: fontFamily.bold },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: space.lg,
    gap: space.sm,
    marginBottom: space.md,
  },
  statTileWrap: { flexBasis: '47%', flexGrow: 1 },
  statTile: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  statTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs },
  statIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statIconGood: { backgroundColor: '#E7F5EC' },
  statIconBad: { backgroundColor: '#FDECEC' },
  statValue: { ...text.title, fontSize: 22, lineHeight: 28, color: colors.fg },
  statLabel: { ...text.caption, color: colors.muted },

  empty: { padding: space.xl, alignItems: 'center' },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  emptyText: { ...text.body, color: colors.muted },

  rideCard: {
    flexDirection: 'row',
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rideCardPressed: { backgroundColor: colors.bgSunken },
  rideIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  rideTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rideId: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, flex: 1 },
  statusPill: { paddingHorizontal: space.xs, paddingVertical: 2, borderRadius: radius.pill },
  rideStatus: { ...text.caption, fontFamily: fontFamily.semibold, fontSize: 11 },
  rideDate: { ...text.caption, color: colors.faint, marginTop: 2 },
  rideDriverRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  rideDriver: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },

  rideRoute: { flexDirection: 'row', marginTop: space.sm },
  rideRouteMarkers: { alignItems: 'center', width: 8, marginRight: space.sm },
  ridePlaceDotPickup: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  ridePlaceDotDrop: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  rideRouteLine: { width: 1, flex: 1, minHeight: 14, backgroundColor: colors.border },
  rideRouteText: { flex: 1, justifyContent: 'space-between' },
  ridePlace: { ...text.caption, color: colors.muted },

  rideRight: { alignItems: 'flex-end', justifyContent: 'space-between', marginLeft: space.sm, gap: space.sm },
  ridePrice: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },

  rebookChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  rebookChipPressed: { backgroundColor: colors.brandSoft, borderColor: colors.borderStrong },
  rebookChipLabel: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },

  sheetTitle: { ...text.heading, color: colors.fg, marginBottom: space.sm },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sortOptionLabel: { ...text.body, color: colors.fg },
});
