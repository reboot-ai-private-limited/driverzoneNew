import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { LedgerEntryDto, TransactionType } from '@driverzone/contracts';
import { type ComponentProps, type ReactElement } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getEarnings } from '@/lib/api/endpoints/driver';
import { keys } from '@/lib/query/keys';
import { colors, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * Earnings — the driver's own ledger, and the screen that answers "what am I owed?".
 *
 * **Every number here is the server's.** `GET /driver/wallet` runs the same use case and the same
 * mapper as the admin's `/admin/drivers/:id/wallet`, so what a driver reads here is what an admin
 * reads about them. That is the point: this screen exists to be checked against a payout, and a
 * second derivation of the running balance would eventually disagree with the first — an argument
 * about money that neither side could win.
 *
 * **The balance changes its WORDS, not its sign.** Positive means DriverZone owes the driver;
 * negative means the driver is holding company cash they took from customers. Rendering a minus
 * sign and leaving them to work out which way it points is how a driver concludes they have been
 * charged for working. Same call the customer app's wallet screen makes, for the same reason.
 *
 * **An empty statement is a real answer, not a loading state.** The placeholder this replaced
 * refused to render a zeroed dashboard because "₹0 today" is indistinguishable from missing data.
 * That reasoning still holds and is why the empty case says no trips have settled *yet* rather
 * than drawing an empty chart.
 */

/** Enough that the first screen is full on any handset, small enough to stay one quick request. */
const PAGE_SIZE = 20;

export default function EarningsScreen(): ReactElement {
  const earnings = useInfiniteQuery({
    queryKey: keys.earnings.statement(),
    queryFn: ({ pageParam }) => getEarnings(pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.total_pages ? last.pagination.page + 1 : undefined,
  });

  const pages = earnings.data?.pages ?? [];
  /*
   * The wallet totals ride on every page but only the FIRST is current: pages 2+ were fetched
   * earlier and carry the balance as it stood then. Reading page 0 keeps the headline honest
   * while "load more" is appending older history beneath it.
   */
  const wallet = pages[0]?.wallet ?? null;
  const rows = pages.flatMap((page) => page.ledger);

  if (earnings.isPending) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={colors.fg} />
      </View>
    );
  }

  if (earnings.isError) {
    return (
      <View style={styles.centred}>
        <Feather name="wifi-off" size={28} color={colors.muted} />
        <Text style={styles.errorTitle}>Could not load your earnings</Text>
        <Text style={styles.errorBody}>
          {earnings.error instanceof Error
            ? earnings.error.message
            : 'Check your connection and try again.'}
        </Text>
        <Pressable
          onPress={() => void earnings.refetch()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const owed = (wallet?.balance_paise ?? 0) < 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Earnings</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        // Pull-to-refresh: this is the screen a driver opens at the end of a shift to check a
        // trip landed, and that question deserves to be askable directly.
        refreshControl={
          <RefreshControl
            refreshing={earnings.isRefetching && !earnings.isFetchingNextPage}
            onRefresh={() => void earnings.refetch()}
            tintColor={colors.muted}
          />
        }
      >
        <View style={[styles.balanceCard, owed && styles.balanceCardOwed]}>
          <Text style={styles.balanceLabel}>{owed ? 'You owe' : 'Your balance'}</Text>
          <Text style={[styles.balanceValue, owed && styles.balanceValueOwed]}>
            {formatPaise(Math.abs(wallet?.balance_paise ?? 0))}
          </Text>
          <Text style={styles.balanceHint}>
            {owed
              ? 'Cash you collected from customers, held on DriverZone’s behalf.'
              : 'Settled to you in your next payout.'}
          </Text>
        </View>

        {/*
          The one thing on this screen a driver must not miss. A suspended driver is offered no
          trips at all, and without this they would spend the day on duty wondering why the phone
          never rang. `is_suspended_for_balance` is computed against the same setting dispatch
          filters on, so this shows exactly when work has actually stopped.
        */}
        {wallet?.is_suspended_for_balance === true ? (
          <View style={styles.suspended} accessibilityLiveRegion="polite">
            <Feather name="alert-triangle" size={18} color={colors.danger} />
            <View style={styles.suspendedText}>
              <Text style={styles.suspendedTitle}>Trips are paused</Text>
              <Text style={styles.suspendedBody}>
                Your balance has gone past the limit, so you are not being offered trips. Settle
                the cash you are holding to start receiving work again.
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.lifetimeRow}>
          <View style={styles.lifetimeIcon}>
            <Feather name="trending-up" size={16} color={colors.dutyOn} />
          </View>
          <Text style={styles.lifetimeLabel}>Lifetime earnings</Text>
          <Text style={styles.lifetimeValue}>
            {formatPaise(wallet?.lifetime_earnings_paise ?? 0)}
          </Text>
        </View>

        <Text style={styles.sectionHeading}>Statement</Text>

        {rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="bar-chart-2" size={26} color={colors.muted} />
            </View>
            <Text style={styles.emptyTitle}>No earnings yet</Text>
            <Text style={styles.emptyBody}>
              Once you complete a trip, every fare, commission and cash collection appears here —
              with the balance after each one.
            </Text>
          </View>
        ) : (
          <View style={styles.statement}>
            {rows.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </View>
        )}

        {earnings.hasNextPage ? (
          <Pressable
            onPress={() => void earnings.fetchNextPage()}
            disabled={earnings.isFetchingNextPage}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.loadMore,
              pressed && styles.pressed,
              earnings.isFetchingNextPage && styles.pressed,
            ]}
          >
            {earnings.isFetchingNextPage ? (
              <ActivityIndicator color={colors.fg} />
            ) : (
              <Text style={styles.loadMoreLabel}>Show older</Text>
            )}
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function EntryRow({ entry }: { entry: LedgerEntryDto }): ReactElement {
  const credit = entry.amount_paise >= 0;
  const style = ENTRY_STYLES[entry.type];

  return (
    <View style={styles.entry}>
      <View style={[styles.entryIcon, { backgroundColor: style.bg }]}>
        <Feather name={style.icon} size={15} color={style.fg} />
      </View>

      <View style={styles.entryMain}>
        <Text style={styles.entryDescription} numberOfLines={2}>
          {entry.description}
        </Text>
        <Text style={styles.entryDate}>{formatDate(entry.created_at)}</Text>
      </View>

      <View style={styles.entryAmounts}>
        {/*
          The sign is shown, always. A ledger that hides which way a row moved is not a ledger —
          and `PAYOUT` in particular is a negative row that is GOOD news, so the colour is kept
          neutral rather than alarming. Red is reserved for a penalty, which genuinely is one.
        */}
        <Text
          style={[
            styles.entryAmount,
            credit && styles.entryAmountCredit,
            entry.type === 'PENALTY' && styles.entryAmountPenalty,
          ]}
        >
          {credit ? '+' : '−'}
          {formatPaise(Math.abs(entry.amount_paise))}
        </Text>
        <Text style={styles.entryBalance}>{formatPaise(entry.balance_after_paise)}</Text>
      </View>
    </View>
  );
}

/**
 * A glyph and a tone per row type.
 *
 * `Record<TransactionType, …>` on purpose — exhaustive over the union, so a type added to
 * contracts fails this file's typecheck rather than rendering as a blank square in a list of
 * money. The same guard the tab icons use.
 */
const ENTRY_STYLES: Record<TransactionType, { icon: FeatherName; fg: string; bg: string }> = {
  TRIP_EARNING: { icon: 'navigation', fg: colors.dutyOn, bg: colors.dutyOnBg },
  WAITING_EARNING: { icon: 'clock', fg: colors.dutyOn, bg: colors.dutyOnBg },
  COMMISSION_DEBIT: { icon: 'percent', fg: colors.muted, bg: colors.bgSunken },
  CASH_COLLECTED: { icon: 'dollar-sign', fg: colors.warning, bg: '#FFF6E0' },
  PAYOUT: { icon: 'arrow-up-right', fg: colors.link, bg: '#EAF1FD' },
  ADJUSTMENT: { icon: 'edit-3', fg: colors.muted, bg: colors.bgSunken },
  PENALTY: { icon: 'alert-triangle', fg: colors.danger, bg: '#FDEEF0' },
  BONUS: { icon: 'gift', fg: colors.dutyOn, bg: colors.dutyOnBg },
};

/**
 * `70875` → `₹708.75`, `70000` → `₹700`.
 *
 * Money crosses the wire as integer paise and is never floated (docs/README.md); the division
 * happens here, at the last possible moment, purely to render. Trailing `.00` is dropped because
 * most fares are whole rupees and a column of `₹700.00` reads as precision that is not being
 * claimed — but real paise are never rounded away, because this is the number a driver checks a
 * payout against.
 */
function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Today and yesterday by name — a statement is read relative to the shift just worked. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

  const today = new Date();
  const isSameDay = (a: Date, b: Date): boolean => a.toDateString() === b.toDateString();

  if (isSameDay(date, today)) return `Today, ${time}`;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(date, yesterday)) return `Yesterday, ${time}`;

  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${time}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    padding: space.lg,
  },

  header: { backgroundColor: colors.brand, paddingHorizontal: space.lg, paddingVertical: space.lg },
  headerTitle: { ...text.title, color: colors.fg },

  scroll: { padding: space.lg, paddingBottom: space.xl },

  errorTitle: { ...text.heading, color: colors.fg, marginTop: space.md, textAlign: 'center' },
  errorBody: { ...text.body, color: colors.muted, marginTop: space.xs, textAlign: 'center' },
  retry: {
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
  },
  retryLabel: { ...text.label, color: colors.brandOnFg },
  pressed: { opacity: 0.85 },

  balanceCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    alignItems: 'center',
    ...shadow.soft,
  },
  balanceCardOwed: { borderColor: colors.warning, backgroundColor: '#FFFCF4' },
  balanceLabel: { ...text.label, color: colors.muted },
  balanceValue: {
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    color: colors.fg,
    marginTop: space.xs,
  },
  balanceValueOwed: { color: colors.warning },
  balanceHint: {
    ...text.caption,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xs,
  },

  suspended: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FDEEF0',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    padding: space.md,
    marginTop: space.md,
  },
  suspendedText: { flex: 1, marginLeft: space.sm },
  suspendedTitle: { ...text.label, color: colors.danger },
  suspendedBody: { ...text.caption, color: colors.fg, marginTop: 2 },

  lifetimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
  },
  lifetimeIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lifetimeLabel: { ...text.body, color: colors.muted, flex: 1, marginLeft: space.sm },
  lifetimeValue: { ...text.heading, color: colors.fg },

  sectionHeading: {
    ...text.label,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.lg,
    marginBottom: space.sm,
  },

  statement: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  entryIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryMain: { flex: 1, marginLeft: space.sm },
  entryDescription: { ...text.body, color: colors.fg },
  entryDate: { ...text.caption, color: colors.faint, marginTop: 1 },
  entryAmounts: { alignItems: 'flex-end', marginLeft: space.sm },
  entryAmount: { ...text.body, fontWeight: '700', color: colors.fg },
  entryAmountCredit: { color: colors.dutyOn },
  entryAmountPenalty: { color: colors.danger },
  entryBalance: { ...text.caption, color: colors.faint, marginTop: 1 },

  loadMore: {
    marginTop: space.md,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  loadMoreLabel: { ...text.label, color: colors.fg },

  empty: {
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.xl,
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  emptyTitle: { ...text.heading, color: colors.fg },
  emptyBody: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.sm },
});
