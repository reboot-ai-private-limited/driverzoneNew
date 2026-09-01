import type { ReactElement } from 'react';
import { Feather } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, space } from '@/theme/theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** The trailing arrow in the approved screens. Off for buttons that do not advance a flow. */
  showArrow?: boolean;
}

/**
 * Black fill, yellow label — the brand's inversion of the login card.
 *
 * `disabled` is a real prop rather than a style, so the button stops responding as well as
 * looking inert. A "Continue" that dims but still fires sends a second OTP request, and the
 * server counts that against the customer's per-phone hourly cap.
 */
export function PrimaryButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  showArrow = true,
}: PrimaryButtonProps): ReactElement {
  const inert = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy: loading }}
      accessibilityLabel={label}
      // A pressed state that is only opacity reads as a rendering glitch on a black fill, so the
      // whole surface lifts slightly instead.
      style={({ pressed }) => [
        styles.root,
        inert && styles.inert,
        pressed && !inert && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.brandOnFg} />
      ) : (
        <View style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          {showArrow ? (
            <Feather name="arrow-right" size={20} color={colors.brandOnFg} style={styles.arrow} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.fg,
    borderRadius: radius.md,
    // 56 keeps the tap target well above the 44dp floor even with the label at its smallest.
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  inert: { opacity: 0.45 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.995 }] },
  row: { flexDirection: 'row', alignItems: 'center' },
  label: { color: colors.brandOnFg, fontSize: 17, fontWeight: '700', fontFamily: fontFamily.bold },
  arrow: { marginLeft: space.sm },
});
