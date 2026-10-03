import { Feather } from '@expo/vector-icons';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import {
  type ComponentProps,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { BottomSheet } from '@/components/BottomSheet';
import {
  rideHistoryQuery,
  type RideHistoryFilter,
  type RideHistorySortOrder,
  type RideHistoryView,
} from '@/features/rides/historyQuery';
import {
  toRideHistoryRow,
  type RideHistoryRow,
  type RideStatus,
} from '@/features/rides/rideHistory';
import { rebookParamsForPoints } from '@/features/booking/rebook';
import { formatPaise } from '@/lib/money';
import { motion } from '@/theme/motion';
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
 * PAGED, WITH FILTERS, SEARCH AND SORT ON THE SERVER. The list loads `HISTORY_PAGE_SIZE` rows at a
 * time and asks for the next page as the customer nears the end. The filters had to move with it:
 * a client-side filter over paged data silently hides every match that is not on a loaded page.
 */

const FILTERS: ReadonlyArray<{ value: RideHistoryFilter; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'SCHEDULED', label: 'Scheduled' },
];

/** Coming back to this tab refreshes the history only if it is at least this old. */
const FOCUS_REFRESH_AFTER_MS = 30_000;

/** Typing pauses this long before the search goes to the server — one request per word, not per key. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Only the cards visible on first paint rise in — about one screenful. Animating all of a long
 * history (55 cards on the test account, each delayed 50ms more than the last) meant dozens of
 * entering animations per visit, the last starting ~2.8s late, and every filter tap repeated them.
 */
const ANIMATED_ROWS = 6;

export default function RidesScreen(): ReactElement {
  const [filter, setFilter] = useState<RideHistoryFilter | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sortSheet, setSortSheet] = useState(false);
  const [sort, setSort] = useState<RideHistorySortOrder>('NEWEST');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const view = useMemo<RideHistoryView>(() => ({ filter, search, sort }), [filter, search, sort]);

  /*
   * REFETCHED ON FOCUS, not polled. History changes only when the customer does something —
   * finishes a trip, cancels one — and both of those happen on another screen in this same app,
   * so coming back to this tab is exactly when it can be stale and the only time it can be.
   *
   * `keepPreviousData`: a chip tap or a new search keeps the old rows on screen, dimmed, until the
   * new first page lands — instead of blanking the list to a skeleton for one round trip.
   */
  const history = useInfiniteQuery({
    ...rideHistoryQuery(view),
    placeholderData: keepPreviousData,
    select: (data) => ({
      rows: data.pages.flatMap((page) => page.bookings.map(toRideHistoryRow)),
      summary: data.pages[0]?.summary ?? null,
    }),
  });

  // A different view starts at its top, not wherever the previous one was scrolled to.
  const listRef = useRef<FlatList<RideHistoryRow>>(null);
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [view]);

  const loadMore = useCallback(() => {
    // Not after a failed page — scrolling would otherwise re-fire it in a loop; the footer retries.
    if (
      history.hasNextPage &&
      !history.isFetchingNextPage &&
      !history.isFetchNextPageError &&
      !history.isPlaceholderData
    ) {
      void history.fetchNextPage();
    }
  }, [history]);

  /*
   * The FIRST focus is skipped: the query is already fetching because the screen just mounted,
   * and refetching on top of it was a second identical request on every first visit.
   */
  const focusedBefore = useRef(false);
  /*
   * Read through a ref, not the closure: the focus callback is created once, and `dataUpdatedAt`
   * changes with every fetch.
   */
  const lastFetchedAt = useRef(0);
  lastFetchedAt.current = history.dataUpdatedAt;
  useFocusEffect(
    useCallback(() => {
      if (!focusedBefore.current) {
        focusedBefore.current = true;
        return;
      }
      /*
       * SILENT, AND ONLY WHEN IT COULD HAVE CHANGED. Flicking between tabs used to refetch every
       * time, and each response re-rendered the whole list mid-transition. History older than
       * `FOCUS_REFRESH_AFTER_MS` is refreshed in the background; anything fresher is left alone.
       */
      if (Date.now() - lastFetchedAt.current < FOCUS_REFRESH_AFTER_MS) return;
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

  const rides = history.data?.rows ?? NO_RIDES;
  /*
   * OVER THE WHOLE HISTORY, never the filtered view — the server sends it with the first page, so
   * the tiles no longer depend on how much of the history happens to be loaded. See
   * `RideHistorySummary` for why spend counts completed trips only, net of wallet credit.
   */
  const summary = history.data?.summary ?? null;

  /*
   * THE ENTRANCE PLAYS ONCE PER VISIT TO THE SCREEN'S FIRST ROWS, then switches off — so filters,
   * sorts, search, later pages and background refreshes swap rows in place instead of replaying it.
   */
  const [entranceDone, setEntranceDone] = useState(false);
  const hasRows = rides.length > 0;
  useEffect(() => {
    if (entranceDone || !hasRows) return undefined;
    const timer = setTimeout(() => setEntranceDone(true), 600);
    return () => clearTimeout(timer);
  }, [entranceDone, hasRows]);

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
        <Animated.View entering={FadeInDown.duration(motion.enter)} style={styles.searchBox}>
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

      {/*
        A VIRTUALISED LIST, not a ScrollView over `.map()`. Only the cards near the screen are
        rendered, so a long history scrolls and switches tabs as smoothly as a short one — the
        ScrollView built every card on every visit and every filter change.
      */}
      <FlatList
        ref={listRef}
        // Dimmed while a new filter or search is loading over the previous one's rows.
        style={[styles.flex, history.isPlaceholderData && styles.stale]}
        // Rows whenever there are any — a failed background refresh keeps what was already shown.
        data={rides}
        keyExtractor={rideKey}
        renderItem={({ item, index }) => (
          <RideItem ride={item} index={index} animate={!entranceDone && index < ANIMATED_ROWS} />
        )}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        // Infinite scroll: the next page is asked for while about half a screen is still left.
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        ListFooterComponent={
          history.isFetchingNextPage ? (
            <RideListSkeleton rows={2} />
          ) : history.isFetchNextPageError ? (
            <Pressable
              onPress={() => void history.fetchNextPage()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.retry, styles.footerRetry, pressed && styles.retryPressed]}
            >
              <Feather name="refresh-cw" size={14} color={colors.fg} />
              <Text style={styles.retryLabel}>Couldn’t load more. Try again</Text>
            </Pressable>
          ) : null
        }
        // Pull-to-refresh, because this is a list a customer will reach for after a trip ends and
        // "did my last ride land?" deserves an answer they can ask for directly.
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={pullToRefresh}
            tintColor={colors.muted}
          />
        }
        ListHeaderComponent={
          <>
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
                Plain Views, NOT an entering animation. One on the first tile froze part-way on
                Android and left "Total Trips" pushed down over the first ride card for good. These
                are the screen's static header, already in place the moment it opens.
              */}
              <View style={styles.statTileWrap}>
                <StatTile
                  icon="headphones"
                  label="Total Trips"
                  value={String(summary?.total_trips ?? 0)}
                  loading={history.isPending}
                />
              </View>
              <View style={styles.statTileWrap}>
                <StatTile
                  icon="credit-card"
                  label="Total Spent"
                  value={summary?.total_spent.amount_display ?? formatPaise(0)}
                  loading={history.isPending}
                />
              </View>
            </View>
          </>
        }
        ListEmptyComponent={
          history.isPending ? (
            <RideListSkeleton />
          ) : history.isError && !hasRows ? (
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
        ) : (
          // `ListEmptyComponent` only renders when there are no rows to show.
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
              {summary?.total_trips === 0
                ? 'No rides yet. Your trips will show up here.'
                : 'No rides match this filter.'}
            </Text>
          </View>
          )
        }
      />

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

const NO_RIDES: RideHistoryRow[] = [];

function rideKey(ride: RideHistoryRow): string {
  return ride.id;
}

/**
 * One ride card in the list. The first screenful rises in on the screen's first paint, staggered
 * top to bottom; every other card — further down, or after a filter or refresh — appears in place.
 */
function RideItem({
  ride,
  index,
  animate,
}: {
  ride: RideHistoryRow;
  index: number;
  animate: boolean;
}): ReactElement {
  // Spread rather than `entering={cond ? x : undefined}`: with `exactOptionalPropertyTypes` an
  // explicit `undefined` is not the same as leaving the prop out.
  return (
    <Animated.View {...(animate ? { entering: FadeInDown.delay(index * motion.stagger).duration(motion.emphasis) } : {})}>
      <RideRow ride={ride} />
    </Animated.View>
  );
}

/**
 * THE LOADING STATE IS THE LIST'S OWN SHAPE, not a spinner. Cards with grey bars where the text
 * will be, so the screen reads as "your rides, arriving" and does not jump when they land. One
 * shared opacity pulse drives every block — a single animated value on the UI thread.
 */
/** `rows` placeholder cards — a screenful on first load, two under the list while a page loads. */
function RideListSkeleton({ rows = 4 }: { rows?: number }): ReactElement {
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 750, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={pulseStyle} accessibilityLabel="Loading your rides">
      {Array.from({ length: rows }, (_, key) => (
        <View key={key} style={styles.rideCard}>
          <View style={[styles.rideIcon, styles.skeletonFill]} />
          <View style={styles.flex}>
            <View style={[styles.skeletonBar, styles.skeletonTitle]} />
            <View style={[styles.skeletonBar, styles.skeletonShort]} />
            <View style={[styles.skeletonBar, styles.skeletonLine]} />
            <View style={[styles.skeletonBar, styles.skeletonLine]} />
          </View>
          <View style={[styles.skeletonBar, styles.skeletonPrice]} />
        </View>
      ))}
    </Animated.View>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone = 'default',
  loading = false,
}: {
  icon: FeatherName;
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
  /** A grey bar in place of the figure — a "0" while loading would be a wrong number, not a blank. */
  loading?: boolean;
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
        {loading ? (
          <View style={[styles.skeletonBar, styles.skeletonStat]} />
        ) : (
          <Text style={styles.statValue}>{value}</Text>
        )}
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
  stale: { opacity: 0.55 },
  footerRetry: { alignSelf: 'center', marginBottom: space.lg },

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

  // ── Loading skeleton ───────────────────────────────────────────────────────────────────────
  skeletonFill: { backgroundColor: colors.bgSunken },
  skeletonBar: { height: 10, borderRadius: radius.pill, backgroundColor: colors.bgSunken },
  skeletonTitle: { width: '55%', height: 12 },
  skeletonShort: { width: '35%', marginTop: space.sm },
  skeletonLine: { width: '80%', marginTop: space.sm },
  skeletonPrice: { width: 48, height: 12, marginLeft: space.sm },
  skeletonStat: { width: 56, height: 20 },

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
