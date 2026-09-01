import type { ReactElement } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { colors } from '@/theme/theme';

interface ToggleSwitchProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Read by screen readers in place of "switch" — name the thing being turned on, not the control. */
  accessibilityLabel: string;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const THUMB_SIZE = 20;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - 2 * 3; // padding of 3 on each side

/**
 * A themed pill switch, not the OS `Switch` — the same call every other control in this app has
 * made (`DirectionToggle`, `DateTimeChooser`): a system green track next to this palette's yellow
 * and near-black would read as borrowed from a different app.
 */
export function ToggleSwitch({
  value,
  onChange,
  disabled = false,
  accessibilityLabel,
}: ToggleSwitchProps): ReactElement {
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: withTiming(value ? colors.fg : colors.bgSunken, { duration: 150 }),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: withTiming(value ? THUMB_TRAVEL : 0, { duration: 150 }) }],
  }));

  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.hit,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Animated.View style={[styles.track, trackStyle, !value && styles.trackOff]}>
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { padding: 2 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: 3,
    justifyContent: 'center',
  },
  trackOff: { borderWidth: 1, borderColor: colors.border },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.card,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
