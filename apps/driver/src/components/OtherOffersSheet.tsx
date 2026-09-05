import { Feather } from '@expo/vector-icons';
import type { DriverOfferDto } from '@driverzone/contracts';
import { type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface OtherOffersSheetProps {
  visible: boolean;
  /** Already sorted soonest-expiring first — the server does this, nobody re-sorts it. */
  offers: readonly DriverOfferDto[];
  onClose: () => void;
  onSelect: (offerId: string) => void;
}

/**
 * "+N more requests waiting" — a quick glance, not a second decision screen.
 *
 * A driver looking at this has already got a full-screen ring open for their most urgent offer;
 * this sheet exists only to let them see what else is ringing and switch to it if they would
 * rather deal with that one first. Selecting a row does not decline or otherwise touch the offer
 * being left behind — it keeps ringing on its own until someone (possibly this same driver, after
 * switching back) answers it or it lapses.
 *
 * NO TICKING COUNTDOWN here, deliberately. The parent screen already polls the offer list every
 * few seconds, so "~Ns left" is recomputed on every one of those refreshes — that is enough
 * accuracy for a list you glance at and pick from, and a second independently-ticking timer per
 * row is machinery this sheet does not need.
 */
export function OtherOffersSheet({
  visible,
  offers,
  onClose,
  onSelect,
}: OtherOffersSheetProps): ReactElement {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>
        {offers.length} more {offers.length === 1 ? 'request' : 'requests'} waiting
      </Text>
      <Text style={styles.sub}>
        Switching does not give up your current trip — it keeps ringing until you come back to it.
      </Text>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {offers.map((offer) => (
          <Pressable
            key={offer.offer_id}
            onPress={() => onSelect(offer.offer_id)}
            accessibilityRole="button"
            accessibilityLabel={`Switch to trip ${offer.reference}, you earn ${offer.earning.amount_display}`}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.rowIcon}>
              <Feather name="navigation" size={16} color={colors.fg} />
            </View>

            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={styles.reference} numberOfLines={1}>
                  {offer.reference}
                </Text>
                <Text style={styles.remaining}>{remainingLabel(offer.expires_at)}</Text>
              </View>
              <Text style={styles.pickup} numberOfLines={1}>
                {offer.pickup.address}
              </Text>
            </View>

            <Text style={styles.earning} numberOfLines={1}>
              {offer.earning.amount_display}
            </Text>
            <Feather name="chevron-right" size={16} color={colors.faint} />
          </Pressable>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

/** "~32s left", floored at zero — a row is left visible for the tick where it hits 0 rather than
    disappearing mid-render; the next list refetch removes it once the server agrees it is gone. */
function remainingLabel(expiresAt: string): string {
  const seconds = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
  return `~${String(seconds)}s left`;
}

const styles = StyleSheet.create({
  title: { ...text.heading, color: colors.fg },
  sub: { ...text.body, color: colors.muted, marginTop: space.xs, marginBottom: space.md },

  scroll: { maxHeight: 320 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowPressed: { backgroundColor: colors.bgSunken },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  rowBody: { flex: 1, marginRight: space.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  reference: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, flex: 1 },
  remaining: { ...text.caption, color: colors.muted },
  pickup: { ...text.caption, color: colors.muted, marginTop: 1 },
  earning: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, marginRight: space.xs },
});
