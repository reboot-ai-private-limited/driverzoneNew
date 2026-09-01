import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { AddressLabel, SavedAddressDto } from '@driverzone/contracts';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/** One icon per label, so a customer finds Home by shape before they read the word. */
const ICONS: Record<AddressLabel, FeatherName> = {
  HOME: 'home',
  OFFICE: 'briefcase',
  OTHER: 'map-pin',
};

const TITLES: Record<AddressLabel, string> = {
  HOME: 'Home',
  OFFICE: 'Office',
  OTHER: 'Saved',
};

interface SavedPlaceRowProps {
  saved: SavedAddressDto;
  onPress: (saved: SavedAddressDto) => void;
  /** True when this place IS the end currently being chosen. */
  selected?: boolean;
  /**
   * Whether to flag the preferred-pickup address.
   *
   * OFF on the booking screen, and that is the point: there the list SETS A DESTINATION, so a
   * row badged "Pickup" contradicts the tap it is inviting. The flag is a property of the saved
   * address, not of the action, so it belongs on the Account tab where the list describes
   * rather than does.
   */
  showPickupBadge?: boolean;
  /** Omitted where removal does not belong, which is why it is not a boolean. */
  onRemove?: ((saved: SavedAddressDto) => void) | undefined;
  removing?: boolean;
}

/**
 * A saved place, as a one-tap destination.
 *
 * A LIST rather than horizontal chips. Chips truncate an address to a few characters, which is
 * fine for "Home" and useless for the third and fourth saved place — and a customer who saved two
 * addresses in the same area needs to read enough of each to tell them apart.
 */
export function SavedPlaceRow({
  saved,
  onPress,
  selected = false,
  showPickupBadge = false,
  onRemove,
  removing = false,
}: SavedPlaceRowProps): ReactElement {
  return (
    <Pressable
      onPress={() => onPress(saved)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${TITLES[saved.label]}: ${saved.address}`}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.icon, selected && styles.iconSelected]}>
        <Feather name={ICONS[saved.label]} size={17} color={colors.fg} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{TITLES[saved.label]}</Text>
          {/* The bookmark says WHY this row is here: it is saved, not a search result or a recent
              trip. Once the list mixes those sources, position alone stops carrying that. */}
          <Feather name="bookmark" size={12} color={colors.faint} />
        </View>
        <Text style={styles.address} numberOfLines={1}>
          {saved.address}
        </Text>
      </View>

      {selected ? (
        <Feather name="check" size={18} color={colors.fg} style={styles.trailing} />
      ) : null}

      {showPickupBadge && saved.is_preferred_pickup ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>Pickup</Text>
        </View>
      ) : null}

      {onRemove !== undefined ? (
        <Pressable
          onPress={() => onRemove(saved)}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${TITLES[saved.label]} from saved places`}
          disabled={removing}
          // Generous, because the target is small and sits beside a much larger one whose action
          // is completely different.
          hitSlop={12}
          style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
        >
          {removing ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Feather name="trash-2" size={15} color={colors.muted} />
          )}
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A surface, not a bare row: over a white sheet the saved list was three unattached lines of
  // text, and a tap target reads as tappable when it has an edge.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    marginBottom: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { backgroundColor: colors.border },
  // A DARK EDGE, not a tint: the brand yellow is a surface at 1.1:1 against white, so a
  // yellow-filled selected row is indistinguishable from an unselected one in bright sun. Ink on
  // the border carries at any brightness.
  rowSelected: { borderColor: colors.fg, borderWidth: 2, backgroundColor: colors.brandSoft },
  iconSelected: { backgroundColor: colors.brand },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { ...text.label, color: colors.fg },
  address: { ...text.caption, color: colors.muted, marginTop: 1 },
  trailing: { marginRight: 2 },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  badgeLabel: {
    ...text.caption,
    color: colors.fg,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
  },
  remove: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePressed: { backgroundColor: colors.border },
});
