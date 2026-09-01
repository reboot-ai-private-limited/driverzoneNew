import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ComponentProps, type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BottomSheet } from '@/components/BottomSheet';
import {
  DEMO_RIDES,
  type DemoRide,
  type DemoRideStatus,
  formatDemoPaise,
} from '@/features/rides/demoRides';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * Ride history.
 *
 * DEMO DATA, ON PURPOSE AND VISIBLY SO — see `demoRides.ts`'s own header for the full reasoning.
 * `GET /customer/bookings` (a list) does not exist on the API; this screen renders exactly what
 * was asked for, with a badge that never lets it pass as real. The badge is not decoration, it is
 * the condition this screen was built under.
 */

type Filter = 'TODAY' | 'THIS_MONTH' | DemoRideStatus;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'THIS_MONTH', label: 'This Month' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RUNNING', label: 'Running' },
];

type SortOrder = 'NEWEST' | 'AMOUNT_DESC';

export default function RidesScreen(): ReactElement {
  const [filter, setFilter] = useState<Filter | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sortSheet, setSortSheet] = useState(false);
  const [sort, setSort] = useState<SortOrder>('NEWEST');

  const rides = useMemo(() => {
    let list = [...DEMO_RIDES];

    if (filter === 'COMPLETED' || filter === 'CANCELLED' || filter === 'RUNNING') {
      list = list.filter((ride) => ride.status === filter);
    }
    // "Today"/"This Month" are real date filters over the (invented) `at` field — the FILTER is
    // real logic, only the rows it filters are fabricated.
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
      list = list.filter(
        (ride) =>
          ride.id.toLowerCase().includes(needle) ||
          ride.driverName.toLowerCase().includes(needle) ||
          ride.pickup.toLowerCase().includes(needle) ||
          ride.drop.toLowerCase().includes(needle),
      );
    }

    list.sort((a, b) =>
      sort === 'NEWEST' ? Date.parse(b.at) - Date.parse(a.at) : b.totalPaise - a.totalPaise,
    );

    return list;
  }, [filter, query, sort]);

  const stats = useMemo(() => {
    const completed = DEMO_RIDES.filter((r) => r.status === 'COMPLETED');
    const totalSpent = completed.reduce((sum, r) => sum + r.totalPaise, 0);
    return {
      total: DEMO_RIDES.length,
      totalSpent,
    };
  }, []);

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

      <View style={styles.demoBadge}>
        <Feather name="info" size={12} color={colors.muted} />
        <Text style={styles.demoBadgeText}>
          Demo data — the API has no ride-history list yet. These are not your real trips.
        </Text>
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
          <Stagger index={0} style={styles.statTileWrap}>
            <StatTile icon="headphones" label="Total Trips" value={String(stats.total)} />
          </Stagger>
          <Stagger index={1} style={styles.statTileWrap}>
            <StatTile
              icon="credit-card"
              label="Total Spent"
              value={formatDemoPaise(stats.totalSpent)}
            />
          </Stagger>
        </View>

        {rides.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="inbox" size={22} color={colors.muted} />
            </View>
            <Text style={styles.emptyText}>No rides match this filter.</Text>
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

const STATUS_COPY: Record<DemoRideStatus, { label: string; color: string; tint: string }> = {
  COMPLETED: { label: 'Completed', color: colors.success, tint: '#E7F5EC' },
  CANCELLED: { label: 'Cancelled', color: colors.danger, tint: '#FDECEC' },
  RUNNING: { label: 'Running', color: colors.link, tint: '#E9F0FC' },
};

function RideRow({ ride }: { ride: DemoRide }): ReactElement {
  const statusCopy = STATUS_COPY[ride.status];
  const when = new Date(ride.at);
  const dateLabel = `${String(when.getDate()).padStart(2, '0')} ${MONTHS[when.getMonth()]} ${String(
    when.getFullYear(),
  )}, ${formatClock(when)}`;

  return (
    <Pressable
      onPress={() => router.push(`/rides/${ride.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.rideCard, pressed && styles.rideCardPressed]}
    >
      <View style={styles.rideIcon}>
        <Feather name="truck" size={18} color={colors.fg} />
      </View>

      <View style={styles.flex}>
        <View style={styles.rideTopRow}>
          <Text style={styles.rideId} numberOfLines={1}>
            {ride.id}
          </Text>
          <View style={[styles.statusPill, { backgroundColor: statusCopy.tint }]}>
            <Text style={[styles.rideStatus, { color: statusCopy.color }]}>{statusCopy.label}</Text>
          </View>
        </View>
        <Text style={styles.rideDate}>{dateLabel}</Text>

        <View style={styles.rideDriverRow}>
          <Text style={styles.rideDriver} numberOfLines={1}>
            {ride.driverName}
          </Text>
          <Feather name="star" size={11} color={colors.brand} style={styles.rideStar} />
          <Text style={styles.rideRating}>{ride.driverRating.toFixed(1)}</Text>
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
        <Text style={styles.ridePrice}>{formatDemoPaise(ride.totalPaise)}</Text>
        <Feather name="chevron-right" size={16} color={colors.faint} />
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

  demoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginHorizontal: space.lg,
    marginTop: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSunken,
  },
  demoBadgeText: { ...text.caption, color: colors.muted, flex: 1 },

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
  rideStar: { marginLeft: space.xs, marginRight: 2 },
  rideRating: { ...text.caption, color: colors.muted },

  rideRoute: { flexDirection: 'row', marginTop: space.sm },
  rideRouteMarkers: { alignItems: 'center', width: 8, marginRight: space.sm },
  ridePlaceDotPickup: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  ridePlaceDotDrop: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  rideRouteLine: { width: 1, flex: 1, minHeight: 14, backgroundColor: colors.border },
  rideRouteText: { flex: 1, justifyContent: 'space-between' },
  ridePlace: { ...text.caption, color: colors.muted },

  rideRight: { alignItems: 'flex-end', justifyContent: 'space-between', marginLeft: space.sm },
  ridePrice: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },

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
