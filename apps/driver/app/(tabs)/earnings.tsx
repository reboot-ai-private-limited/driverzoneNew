import { Feather } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { TRANSACTION_TYPES, type LedgerEntryDto, type TransactionType } from '@driverzone/contracts';
import { type ComponentProps, type ReactElement, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { getEarnings, type EarningsFilter } from '@/lib/api/endpoints/driver';
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

/**
 * The periods worth offering, as the questions a driver actually asks.
 *
 * `null` is "all time" and is the default — a statement with a period silently pre-applied is one
 * where a missing row looks like a missing payment.
 */
type Period = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH';

const PERIODS: ReadonlyArray<{ value: Period; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'THIS_MONTH', label: 'This month' },
];

/**
 * The type chips, grouped the way a driver thinks about money rather than the way the ledger
 * stores it: what came in, what was taken off, what was paid out.
 *
 * Each preset maps to several `TransactionType`s, so one tap answers "what did I actually earn"
 * without asking a driver to know that waiting time is its own row type.
 */
const TYPE_PRESETS: ReadonlyArray<{
  key: string;
  label: string;
  icon: FeatherName;
  types: readonly TransactionType[];
}> = [
  {
    key: 'EARNINGS',
    label: 'Earnings',
    icon: 'trending-up',
    types: ['TRIP_EARNING', 'WAITING_EARNING', 'BONUS'],
  },
  {
    key: 'DEDUCTIONS',
    label: 'Deductions',
    icon: 'trending-down',
    types: ['COMMISSION_DEBIT', 'CASH_COLLECTED', 'PENALTY'],
  },
  { key: 'PAYOUTS', label: 'Payouts', icon: 'arrow-up-right', types: ['PAYOUT'] },
];

/** `Date` → `YYYY-MM-DD` in LOCAL time — see the same note in `documentFields.ts`. */
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A period as the inclusive `from`/`to` days the server expects.
 *
 * The week starts MONDAY, which is what a driver's week is here — `getDay()` returns 0 for Sunday,
 * so it is shifted before subtracting.
 */
function periodRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const to = toIsoDate(now);

  if (period === 'TODAY') return { from: to, to };

  const start = new Date(now);
  if (period === 'THIS_WEEK') {
    const dayFromMonday = (now.getDay() + 6) % 7;
    start.setDate(now.getDate() - dayFromMonday);
  } else {
    start.setDate(1);
  }

  return { from: toIsoDate(start), to };
}

export default function EarningsScreen(): ReactElement {
  const [period, setPeriod] = useState<Period | null>(null);
  const [types, setTypes] = useState<readonly TransactionType[]>([]);
  const [typeSheet, setTypeSheet] = useState(false);

  /**
   * The filter, and the query key with it.
   *
   * Built by OMISSION so an unfiltered screen sends exactly the request it always did — an empty
   * `type=` would fail the server's own `min(1)`, and a `from` of "all time" does not exist.
   */
  const filter = useMemo<EarningsFilter>(() => {
    const range = period === null ? null : periodRange(period);
    return {
      ...(types.length === 0 ? {} : { types }),
      ...(range === null ? {} : { from: range.from, to: range.to }),
    };
  }, [period, types]);

  const isFiltered = period !== null || types.length > 0;

  const earnings = useInfiniteQuery({
    // Serialised into the key: filtering happens on the server, so a different filter is a
    // different response and must not share a cache entry — see `keys.earnings.statement`.
    queryKey: keys.earnings.statement({ period, types }),
    queryFn: ({ pageParam }) => getEarnings(pageParam, PAGE_SIZE, filter),
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
  const summary = pages[0]?.summary ?? null;
  const rows = pages.flatMap((page) => page.ledger);

  /*
   * THE FIRST LOAD ONLY, and the distinction matters now that filters exist. Every chip tap is a
   * new query key and therefore `isPending` again — returning a bare full-screen spinner here
   * would tear the filter row off the screen mid-tap and put it back a moment later, which reads
   * as the app restarting. Once there is a balance to show, the chrome stays and only the
   * statement below waits.
   */
  if (earnings.isPending && !isFiltered) {
    return (
      <View style={styles.centred}>
        <ActivityIndicator size="large" color={colors.fg} />
      </View>
    );
  }

  if (earnings.isError && !isFiltered) {
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
  const activeTypeLabel = describeTypes(types);

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

        {/* ── The filters ──────────────────────────────────────────────────────────────── */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsRow}
        >
          {PERIODS.map((option) => {
            const active = period === option.value;
            return (
              <Pressable
                key={option.value}
                // Tapping the active chip clears it — "all time" has no chip of its own, so this
                // is the only way back to the whole statement.
                onPress={() => setPeriod(active ? null : option.value)}
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

          <View style={styles.chipDivider} />

          <Pressable
            onPress={() => setTypeSheet(true)}
            accessibilityRole="button"
            accessibilityState={{ selected: types.length > 0 }}
            style={({ pressed }) => [
              styles.chip,
              types.length > 0 && styles.chipActive,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.chipInner}>
              <Feather
                name="sliders"
                size={13}
                color={types.length > 0 ? colors.fg : colors.muted}
              />
              <Text style={[styles.chipLabel, types.length > 0 && styles.chipLabelActive]}>
                {activeTypeLabel ?? 'Type'}
              </Text>
            </View>
          </Pressable>

          {isFiltered ? (
            <Pressable
              onPress={() => {
                setPeriod(null);
                setTypes([]);
              }}
              accessibilityRole="button"
              accessibilityLabel="Clear filters"
              style={({ pressed }) => [styles.clearChip, pressed && styles.pressed]}
            >
              <Feather name="x" size={13} color={colors.danger} />
              <Text style={styles.clearChipLabel}>Clear</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {/*
          THE SELECTION'S OWN TOTALS, straight from the server and across every page of the
          filter — not a sum of the rows on screen, which would grow as "Show older" was tapped
          and quietly disagree with itself. This is what makes a filter an answer rather than a
          shorter list.
        */}
        {summary !== null && summary.count > 0 ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <SummaryCell label="In" value={formatPaise(summary.credited_paise)} tone="good" />
              <View style={styles.summaryDivider} />
              <SummaryCell label="Out" value={formatPaise(summary.debited_paise)} tone="bad" />
              <View style={styles.summaryDivider} />
              <SummaryCell
                label="Net"
                value={`${summary.net_paise < 0 ? '−' : ''}${formatPaise(Math.abs(summary.net_paise))}`}
              />
            </View>
            <Text style={styles.summaryCaption}>
              {summary.count} {summary.count === 1 ? 'entry' : 'entries'}
              {isFiltered ? ' in this filter' : ' in your statement'}
            </Text>
          </Animated.View>
        ) : null}

        {earnings.isPending ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.fg} />
          </View>
        ) : earnings.isError ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="wifi-off" size={26} color={colors.muted} />
            </View>
            <Text style={styles.emptyTitle}>Could not load this</Text>
            <Text style={styles.emptyBody}>
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
        ) : rows.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Feather name="bar-chart-2" size={26} color={colors.muted} />
            </View>
            {/*
              TWO DIFFERENT EMPTIES, and on a screen about money the difference is the whole
              message: "nothing matched your filter" is a control the driver can undo, while
              "no earnings yet" told to someone who has been driving all week would be alarming
              and wrong.
            */}
            <Text style={styles.emptyTitle}>
              {isFiltered ? 'Nothing in this filter' : 'No earnings yet'}
            </Text>
            <Text style={styles.emptyBody}>
              {isFiltered
                ? 'Try a wider period, or clear the filter to see your whole statement.'
                : 'Once you complete a trip, every fare, commission and cash collection appears here — with the balance after each one.'}
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

      {/*
        THE TYPE PICKER. Presets first because they are the questions drivers actually ask, then
        every individual row type underneath for the driver chasing one specific entry — a
        commission they disagree with, a penalty they want to find. Selecting is immediate: there
        is no Apply, so the sheet is a filter being adjusted rather than a form being submitted.
      */}
      <BottomSheet visible={typeSheet} onClose={() => setTypeSheet(false)}>
        <Text style={styles.sheetTitle}>Show only</Text>

        <View style={styles.presetRow}>
          {TYPE_PRESETS.map((preset) => {
            const active = sameTypes(types, preset.types);
            return (
              <Pressable
                key={preset.key}
                onPress={() => setTypes(active ? [] : preset.types)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [
                  styles.preset,
                  active && styles.presetActive,
                  pressed && styles.pressed,
                ]}
              >
                <Feather
                  name={preset.icon}
                  size={16}
                  color={active ? colors.brandOnFg : colors.fg}
                />
                <Text style={[styles.presetLabel, active && styles.presetLabelActive]}>
                  {preset.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sheetSubheading}>Or pick exactly</Text>

        <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
          {TRANSACTION_TYPES.map((type) => {
            const checked = types.includes(type);
            return (
              <Pressable
                key={type}
                onPress={() =>
                  setTypes((current) =>
                    current.includes(type)
                      ? current.filter((value) => value !== type)
                      : [...current, type],
                  )
                }
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                style={({ pressed }) => [styles.typeRow, pressed && styles.pressed]}
              >
                <View style={[styles.typeIcon, { backgroundColor: ENTRY_STYLES[type].bg }]}>
                  <Feather
                    name={ENTRY_STYLES[type].icon}
                    size={14}
                    color={ENTRY_STYLES[type].fg}
                  />
                </View>
                <Text style={styles.typeLabel}>{TYPE_LABELS[type]}</Text>
                <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                  {checked ? <Feather name="check" size={13} color={colors.brandOnFg} /> : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.sheetActions}>
          <PrimaryButton label="Done" onPress={() => setTypeSheet(false)} showArrow={false} />
          {types.length > 0 ? (
            <Pressable
              onPress={() => setTypes([])}
              accessibilityRole="button"
              style={styles.sheetClear}
            >
              <Text style={styles.sheetClearLabel}>Clear selection</Text>
            </Pressable>
          ) : null}
        </View>
      </BottomSheet>
    </View>
  );
}

/** Human names for the wire enum — `TRIP_EARNING` is not a phrase anybody says out loud. */
const TYPE_LABELS: Record<TransactionType, string> = {
  TRIP_EARNING: 'Trip earnings',
  WAITING_EARNING: 'Waiting time',
  EXTENSION_EARNING: 'Extra day',
  COMMISSION_DEBIT: 'Commission',
  CASH_COLLECTED: 'Cash collected',
  PAYOUT: 'Payouts',
  DEBT_COLLECTED: 'Cash settled',
  ADJUSTMENT: 'Adjustments',
  PENALTY: 'Penalties',
  BONUS: 'Bonuses',
};

/** Set equality, order-insensitive — a preset stays "on" however its types were selected. */
function sameTypes(a: readonly TransactionType[], b: readonly TransactionType[]): boolean {
  return a.length === b.length && a.every((type) => b.includes(type));
}

/**
 * What the Type chip says. A preset by its own name, one type by its name, anything else by a
 * count — three labels is wider than the chip and reads as noise.
 */
function describeTypes(types: readonly TransactionType[]): string | null {
  if (types.length === 0) return null;

  const preset = TYPE_PRESETS.find((candidate) => sameTypes(types, candidate.types));
  if (preset !== undefined) return preset.label;

  const first = types[0];
  if (types.length === 1 && first !== undefined) return TYPE_LABELS[first];
  return `${String(types.length)} types`;
}

function SummaryCell({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'good' | 'bad';
}): ReactElement {
  return (
    <View style={styles.summaryCell}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text
        style={[
          styles.summaryValue,
          tone === 'good' && styles.summaryValueGood,
          tone === 'bad' && styles.summaryValueBad,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
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
  // Same green as the other two earnings: it is money in, from a day the driver agreed to stay.
  EXTENSION_EARNING: { icon: 'calendar', fg: colors.dutyOn, bg: colors.dutyOnBg },
  COMMISSION_DEBIT: { icon: 'percent', fg: colors.muted, bg: colors.bgSunken },
  CASH_COLLECTED: { icon: 'dollar-sign', fg: colors.warning, bg: '#FFF6E0' },
  PAYOUT: { icon: 'arrow-up-right', fg: colors.link, bg: '#EAF1FD' },
  DEBT_COLLECTED: { icon: 'arrow-down-left', fg: colors.link, bg: '#EAF1FD' },
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

  chipsRow: { gap: space.sm, paddingVertical: space.xs, alignItems: 'center' },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  // A dark edge on the active chip, not just the yellow: yellow alone is ~1.1:1 against white.
  chipActive: { backgroundColor: colors.brand, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted },
  chipLabelActive: { color: colors.fg },
  chipDivider: { width: 1, height: 22, backgroundColor: colors.border },
  clearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  clearChipLabel: { ...text.label, color: colors.danger },

  summaryCard: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
    marginBottom: space.sm,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, height: 30, backgroundColor: colors.border },
  summaryLabel: { ...text.caption, color: colors.muted },
  summaryValue: { ...text.label, color: colors.fg, marginTop: 2 },
  summaryValueGood: { color: colors.dutyOn },
  summaryValueBad: { color: colors.warning },
  summaryCaption: {
    ...text.caption,
    color: colors.faint,
    textAlign: 'center',
    marginTop: space.sm,
  },

  sheetTitle: { ...text.heading, color: colors.fg },
  sheetSubheading: {
    ...text.caption,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  sheetScroll: { flexShrink: 1 },
  presetRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  preset: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  presetActive: { backgroundColor: colors.fg, borderColor: colors.fg },
  presetLabel: { ...text.caption, color: colors.fg },
  presetLabelActive: { color: colors.brandOnFg },

  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  typeIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: { ...text.body, color: colors.fg, flex: 1 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.fg, borderColor: colors.fg },

  sheetActions: { marginTop: space.md },
  sheetClear: { alignItems: 'center', paddingVertical: space.md },
  sheetClearLabel: { ...text.body, color: colors.muted },

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
