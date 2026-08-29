import { Feather } from '@expo/vector-icons';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TripPoint } from '@/features/booking/tripPoint';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

interface TripSummaryCardProps {
  pickup: TripPoint | null;
  drop: TripPoint;
  onEditPickup: () => void;
  onEditDrop: () => void;
  onClearDrop: () => void;
}

/**
 * BOTH ENDS ARE SET — so the screen stops asking and starts showing.
 *
 * This replaces the destination field the moment a destination exists. That swap is the point: a
 * search field still offering "Where are you going?" under an answered question reads as though
 * the choice did not register.
 *
 * Sized for READING, not just for glancing. An earlier pass shrank this to caption-sized text on
 * an 8px dot, which saved vertical space but made the trip itself — the thing this card exists to
 * show — the hardest-to-read line on the screen. `text.body` and a real border bring it back to
 * legible without returning to the first version's header row and 34pt icon discs.
 */
export function TripSummaryCard({
  pickup,
  drop,
  onEditPickup,
  onEditDrop,
  onClearDrop,
}: TripSummaryCardProps): ReactElement {
  return (
    <View style={styles.card}>
      <View style={styles.rows}>
        <Row
          value={pickup?.address ?? 'Set your pickup point'}
          muted={pickup === null}
          onPress={onEditPickup}
        />
        {/* A short rule between the two marks, not a full column-height rail: at this size the
            two rows already read as one connected trip, and a rail running their full height was
            doing the same job the proximity already does. */}
        <View style={styles.joint} />
        <Row value={drop.address} onPress={onEditDrop} last />
      </View>

      {/* Its own tap target, not folded into the destination row: clearing is a different action
          from changing, and the two must never fire from one ambiguous tap. */}
      <Pressable
        onPress={onClearDrop}
        accessibilityRole="button"
        accessibilityLabel="Clear destination"
        hitSlop={10}
        style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
      >
        <Feather name="x" size={15} color={colors.muted} />
      </Pressable>
    </View>
  );
}

function Row({
  value,
  muted = false,
  onPress,
  last = false,
}: {
  value: string;
  muted?: boolean;
  onPress: () => void;
  last?: boolean;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${value}. Tap to change.`}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={last ? styles.markSquare : styles.markDot} />
      <Text style={[styles.value, muted && styles.valueMuted]} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space.sm,
    paddingLeft: space.md,
    paddingRight: space.sm,
    marginBottom: space.md,
    ...shadow.soft,
  },

  rows: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 6 },
  rowPressed: { opacity: 0.55 },
  markDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.success },
  markSquare: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.fg },
  value: {
    ...text.body,
    color: colors.fg,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
    flex: 1,
  },
  valueMuted: { color: colors.muted, fontWeight: '400', fontFamily: fontFamily.regular },

  joint: {
    width: 1,
    height: 10,
    marginLeft: 4.5,
    backgroundColor: colors.border,
  },

  clear: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearPressed: { backgroundColor: colors.bgSunken },
});
