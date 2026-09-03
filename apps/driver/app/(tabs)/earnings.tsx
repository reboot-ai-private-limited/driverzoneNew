import { Feather } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, text } from '@/theme/theme';

/**
 * Earnings — a placeholder, and openly one.
 *
 * `GET /driver/earnings` does not exist yet (Phase 8, docs/LLD/roadmap.md). The tab ships now so
 * the bar has its final shape from the first install; what it must NOT do is render a zeroed
 * dashboard. "₹0 today · 0 trips" is indistinguishable from real data on a driver's first
 * morning, and a driver who once saw a wrong number checks the app against their own notes
 * forever after.
 *
 * TODO(S-18): GET /driver/earnings?from=&to= — per-trip breakdown (fare, commission split, cash
 * collected), period totals, payout history, and the wallet balance with a warning as it nears
 * the negative-balance threshold that blocks duty.
 */
export default function EarningsScreen(): ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Earnings</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Feather name="bar-chart-2" size={28} color={colors.muted} />
          </View>
          <Text style={styles.emptyTitle}>No earnings yet</Text>
          <Text style={styles.emptyBody}>
            Once trips start, every fare, commission split and cash collection will be itemised
            here — along with your wallet balance and payout history.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.brand, paddingHorizontal: space.lg, paddingVertical: space.lg },
  headerTitle: { ...text.title, color: colors.fg },
  body: { padding: space.lg },

  empty: {
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.xl,
    marginTop: space.xl,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  emptyTitle: { ...text.heading, color: colors.fg },
  emptyBody: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.sm },
});
