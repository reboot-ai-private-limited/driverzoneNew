import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

interface TripPointRowProps {
  /**
   * `compact` is a single quiet line; `hero` is the tall field that owns the screen.
   *
   * The two ends of a trip are NOT equally important on a home screen. The pickup is usually
   * already correct — it is the customer's own GPS position — while the destination is the one
   * thing they opened the app to type. Giving both the same weight makes the customer read two
   * fields to find the one that needs them.
   */
  variant: 'compact' | 'hero';
  label: string;
  /** The chosen address, or `null` when nothing is set yet. */
  value: string | null;
  placeholder: string;
  onPress: () => void;
  busy?: boolean;
}

export function TripPointRow({
  variant,
  label,
  value,
  placeholder,
  onPress,
  busy = false,
}: TripPointRowProps): ReactElement {
  const empty = value === null || value.length === 0;
  const shown = busy && empty ? 'Locating…' : empty ? placeholder : value;

  if (variant === 'compact') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${shown}`}
        style={({ pressed }) => [styles.compact, pressed && styles.pressed]}
      >
        {/* An icon, not a coloured dot. A green circle and a red square carry no meaning to
            someone who has not been told the legend, and they read as status lights — the one
            thing they are not. */}
        <Feather name="navigation" size={13} color={colors.muted} />
        <Text style={styles.compactLabel}>{label}</Text>
        <Text style={[styles.compactValue, empty && styles.faint]} numberOfLines={1}>
          {shown}
        </Text>
        <Feather name="chevron-right" size={16} color={colors.faint} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${shown}`}
      style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
    >
      {/*
        The sheen is what makes this read as GLASS on an opaque sheet. A real backdrop blur has
        nothing to sample here — the surface behind it is flat white — so the cue has to come
        from the light on the surface instead: a bright top edge falling to nothing, over a
        white fill with a soft shadow beneath. That is the same trick a physical pane gives you.
      */}
      <LinearGradient
        colors={['rgba(255,255,255,0.95)', 'rgba(247,247,242,0.65)']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.heroGlyph}>
        <Feather name="search" size={18} color={colors.onFg} />
      </View>

      <View style={styles.heroBody}>
        <Text style={styles.heroLabel}>{label}</Text>
        <Text style={[styles.heroValue, empty && styles.heroPlaceholder]} numberOfLines={1}>
          {shown}
        </Text>
      </View>

      <View style={styles.heroArrow}>
        <Feather name="arrow-right" size={17} color={colors.fg} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
  },
  pressed: { opacity: 0.6 },
  compactLabel: { ...text.caption, color: colors.muted },
  compactValue: {
    ...text.caption,
    color: colors.fg,
    flex: 1,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
  },
  faint: { color: colors.faint, fontWeight: '400', fontFamily: fontFamily.regular },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 68,
    paddingLeft: space.sm,
    paddingRight: space.sm,
    borderRadius: 22,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    // Lifted off the sheet rather than sunk into it. The destination is the screen's primary
    // control and should sit closest to the customer.
    ...shadow.card,
    // Clips the gradient to the rounded corners on Android.
    overflow: 'hidden',
  },
  heroPressed: { borderColor: colors.borderStrong },
  heroGlyph: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: { flex: 1 },
  heroLabel: { ...text.caption, color: colors.muted, marginBottom: 1 },
  heroValue: {
    ...text.body,
    color: colors.fg,
    fontWeight: '700',
    fontFamily: fontFamily.bold,
    fontSize: 16,
  },
  heroPlaceholder: { color: colors.muted, fontWeight: '600', fontFamily: fontFamily.semibold },
  heroArrow: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
