import { Feather } from '@expo/vector-icons';
import type { ReactElement, ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, space } from '@/theme/theme';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The tappable label, so the hit target is the whole row and not just the 20×20 box. */
  children: ReactNode;
  accessibilityLabel: string;
}

/**
 * A square, not `ToggleSwitch`'s pill — the two shapes mark different kinds of choice in this
 * app. A switch flips a preference that changes the price (see `TripOptions`'s insurance row); a
 * checkbox confirms something the customer has read, and confirming is not a thing you can be
 * "half toggled" on the way to.
 */
export function Checkbox({
  checked,
  onChange,
  children,
  accessibilityLabel,
}: CheckboxProps): ReactElement {
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <Feather name="check" size={13} color={colors.brandOnFg} /> : null}
      </View>
      <View style={styles.label}>{children}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  pressed: { opacity: 0.8 },
  box: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxChecked: { backgroundColor: colors.fg, borderColor: colors.fg },
  label: { flex: 1 },
});
