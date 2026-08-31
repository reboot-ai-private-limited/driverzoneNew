import { Feather } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, text } from '@/theme/theme';

/**
 * Trip history.
 *
 * EMPTY BY NECESSITY, not by oversight: `GET /bookings` does not exist. There is no `bookings`
 * module on the API at all (`apps/api/src/routes.ts` mounts identity, zones, settings and
 * packages), and it arrives in roadmap phase 4.
 *
 * The tab exists now anyway because a tab bar that grows an entry later moves every other tab
 * under the customer's thumb. Better an honest empty state than a bar that rearranges itself.
 *
 * What it must NOT do is fake a list. A screen of placeholder trips is indistinguishable from a
 * broken one the day real trips fail to load.
 */
export default function RidesScreen(): ReactElement {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Your rides</Text>

      <View style={styles.empty}>
        <View style={styles.icon}>
          <Feather name="clock" size={26} color={colors.muted} />
        </View>
        <Text style={styles.emptyTitle}>No rides yet</Text>
        <Text style={styles.emptyBody}>
          Trips you book will appear here, with the driver, the fare and the receipt.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  title: { ...text.title, color: colors.fg, marginTop: space.lg },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.xl },
  icon: {
    width: 64,
    height: 64,
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
    marginTop: space.sm,
    paddingHorizontal: space.lg,
  },
});
