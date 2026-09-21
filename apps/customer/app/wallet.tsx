import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ComponentProps, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import {
  WALLET_ENTRY_LABELS,
  type WalletEntryDto,
  type WalletEntryType,
} from '@driverzone/contracts';
import { getWallet } from '@/lib/api/endpoints/wallet';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * The wallet: coupon credit the customer holds, and charges they owe.
 *
 * ONE SIGNED BALANCE, shown as one number, because that is what it is — credit and debt net
 * against each other server-side (`packages/contracts/src/wallet.ts`). The headline changes its
 * WORDS rather than its sign: "Available credit" when positive, "You owe" when negative, so a
 * customer never has to work out what a minus in front of a rupee figure means for them.
 *
 * NO "ADD MONEY" BUTTON, deliberately. Credit only ever arrives by an admin granting it; there is
 * no top-up endpoint and no top-up intent. A button that opened a dead end would be worse than
 * its absence.
 */
export default function WalletScreen(): ReactElement {
  const wallet = useQuery({ queryKey: keys.wallet.me(), queryFn: getWallet });

  const owes = (wallet.data?.amount_owed.amount_paise ?? 0) > 0;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.headerSide}
        >
          <Feather name="chevron-left" size={24} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Wallet</Text>
        <View style={styles.headerSide} />
      </View>

      {wallet.isPending ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.muted} />
        </View>
      ) : wallet.isError ? (
        <View style={styles.centre}>
          <Text style={styles.errorText}>
            {wallet.error instanceof Error ? wallet.error.message : 'We could not load your wallet.'}
          </Text>
          <Pressable
            onPress={() => void wallet.refetch()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Feather name="refresh-cw" size={14} color={colors.fg} />
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Animated.View
            entering={FadeInDown.duration(220)}
            style={[styles.balanceCard, owes && styles.balanceCardOwed]}
          >
            <Text style={styles.balanceLabel}>{owes ? 'You owe' : 'Available credit'}</Text>
            <Text style={[styles.balanceValue, owes && styles.balanceValueOwed]}>
              {owes ? wallet.data.amount_owed.amount_display : wallet.data.spendable_credit.amount_display}
            </Text>
            <Text style={styles.balanceNote}>
              {owes
                ? 'This is added to your next trip, which must be paid by UPI.'
                : 'This comes off your next trip automatically.'}
            </Text>
          </Animated.View>

          <Text style={styles.sectionTitle}>Activity</Text>

          {wallet.data.entries.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Feather name="inbox" size={22} color={colors.muted} />
              </View>
              <Text style={styles.emptyText}>Nothing here yet.</Text>
            </View>
          ) : (
            wallet.data.entries.map((entry, index) => (
              <Animated.View
                key={entry.id}
                entering={FadeInDown.delay(index * 40).duration(200)}
              >
                <EntryRow entry={entry} />
              </Animated.View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * `SPENT_ON_RIDE` and `DEBT_COLLECTED` both point at a trip and both read better as its
 * reference, which the server put in `note` — the wallet module sits below bookings and cannot
 * resolve one itself.
 */
const ENTRY_ICONS: Record<WalletEntryType, FeatherName> = {
  CREDIT_GRANT: 'gift',
  CANCELLATION_FEE: 'x-circle',
  FINE: 'alert-triangle',
  SPENT_ON_RIDE: 'navigation',
  RELEASED_FROM_RIDE: 'corner-up-left',
  DEBT_COLLECTED: 'check-circle',
  ADJUSTMENT: 'edit-3',
};

function EntryRow({ entry }: { entry: WalletEntryDto }): ReactElement {
  const credit = entry.amount.amount_paise > 0;
  const at = new Date(entry.created_at);

  return (
    <View style={styles.entryRow}>
      <View style={[styles.entryIcon, credit && styles.entryIconGood]}>
        <Feather
          name={ENTRY_ICONS[entry.entry_type]}
          size={16}
          color={credit ? colors.success : colors.fg}
        />
      </View>

      <View style={styles.flex}>
        <Text style={styles.entryLabel}>{WALLET_ENTRY_LABELS[entry.entry_type]}</Text>
        {entry.note === null ? null : (
          <Text style={styles.entryNote} numberOfLines={2}>
            {entry.note}
          </Text>
        )}
        <Text style={styles.entryDate}>{formatDateTime(at)}</Text>
      </View>

      {/* The sign is already in `amount_display` for a negative row; a credit gets an explicit
          `+` so the two directions are distinguishable at a glance rather than by reading. */}
      <Text style={[styles.entryAmount, credit && styles.entryAmountGood]}>
        {credit ? `+${entry.amount.amount_display}` : entry.amount.amount_display}
      </Text>
    </View>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateTime(at: Date): string {
  const hours = at.getHours();
  const suffix = hours < 12 ? 'AM' : 'PM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  const clock = `${String(twelve).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')} ${suffix}`;

  return `${String(at.getDate()).padStart(2, '0')} ${MONTHS[at.getMonth()]} ${String(at.getFullYear())}, ${clock}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSide: { width: 32 },
  headerTitle: { ...text.heading, color: colors.fg },

  content: { padding: space.lg, paddingBottom: space.xl },

  /*
   * Brand yellow for credit, a red-tinted surface for a debt. The card is the one element on the
   * screen a customer reads before anything else, so it carries the mood rather than the number
   * carrying it alone.
   */
  balanceCard: {
    borderRadius: radius.lg,
    padding: space.lg,
    backgroundColor: colors.brand,
    marginBottom: space.lg,
  },
  balanceCardOwed: { backgroundColor: colors.dangerSoft },
  balanceLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },
  balanceValue: { ...text.display, color: colors.fg, marginTop: space.xs },
  balanceValueOwed: { color: colors.danger },
  balanceNote: { ...text.caption, color: colors.fg, marginTop: space.xs, opacity: 0.75 },

  sectionTitle: {
    ...text.label,
    color: colors.muted,
    fontFamily: fontFamily.semibold,
    marginBottom: space.sm,
  },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSunken,
  },
  entryIconGood: { backgroundColor: '#E7F5EC' },
  entryLabel: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  entryNote: { ...text.caption, color: colors.muted, marginTop: 1 },
  entryDate: { ...text.caption, color: colors.faint, marginTop: 2 },
  entryAmount: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  entryAmountGood: { color: colors.success },

  empty: { alignItems: 'center', paddingVertical: space.xl },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSunken,
    marginBottom: space.sm,
  },
  emptyText: { ...text.body, color: colors.muted },

  errorText: { ...text.body, color: colors.muted, textAlign: 'center' },
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
});
