import * as Haptics from 'expo-haptics';
/**
 * `BottomTabBarProps` is not re-exported from `expo-router/react-navigation` (its index forwards
 * only `./native` and `./elements`), and `@react-navigation/bottom-tabs` is not a direct
 * dependency — expo-router 57 vendors it. The deep path below is the only place the type lives.
 */
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import type { ReactElement, ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * The signed-in tab bar.
 *
 * Hand-rolled rather than the stock one because the stock bar's selection is a colour swap with
 * no transition: the glyph and label change hue on the frame the route commits, which reads as a
 * jump rather than a move. Everything here runs on the UI thread through Reanimated, so a press
 * stays smooth even while the incoming screen is still mounting — which is exactly when the
 * default bar stutters, because its state change and the screen's first render land in the same
 * JS frame.
 *
 * Three things move, all off one `progress` value per tab:
 *
 *   - a yellow BADGE fades and scales in directly behind the icon — sized to the glyph, not the
 *     tab column, so the highlight reads as "this icon is on" rather than painting the whole
 *     item. The label sits below it, outside the badge, and never gets a background.
 *   - the outline and filled glyphs CROSS-FADE (`tabBarIcon` is rendered twice, once for each
 *     `focused` value) — an icon's `color` prop is a plain string that Reanimated cannot drive,
 *     so two stacked layers with animated opacity is what makes the colour change gradual,
 *   - the label shifts up a hair and darkens.
 *
 * A separate `press` value handles touch-down: a small scale on the badge that springs back on
 * release, so a tap feels answered before the navigation itself happens.
 */

const ICON_SIZE = 22;
/** The badge is a fixed square around the glyph — not the pressable's full width. */
const BADGE_SIZE = 40;

/** Slightly under-damped — the pill settles with a hint of overshoot rather than easing flat. */
const SELECT_SPRING = { damping: 16, stiffness: 200, mass: 0.55 } as const;
/** Stiffer: touch-down feedback has to land inside the same gesture, not after it. */
const PRESS_SPRING = { damping: 20, stiffness: 420, mass: 0.4 } as const;

interface TabItemProps {
  focused: boolean;
  label: string;
  /** `options.tabBarIcon`, called once per `focused` value so the two can be cross-faded. */
  renderIcon: (focused: boolean, color: string) => ReactNode;
  onPress: () => void;
  onLongPress: () => void;
  accessibilityLabel: string;
  testID: string | undefined;
}

function TabItem({
  focused,
  label,
  renderIcon,
  onPress,
  onLongPress,
  accessibilityLabel,
  testID,
}: TabItemProps): ReactElement {
  const progress = useSharedValue(focused ? 1 : 0);
  const press = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(focused ? 1 : 0, SELECT_SPRING);
  }, [focused, progress]);

  // The pressed tint for an UNSELECTED tab. Faded out by `progress` so it never greys the yellow.
  const tintStyle = useAnimatedStyle(() => ({
    opacity: press.value * (1 - progress.value),
  }));

  const badgeStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.75, 1]) }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - 0.08 * press.value }],
  }));

  const restingIconStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));
  const activeIconStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [0, 1], [colors.faint, colors.fg]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [1, 0]) }],
  }));

  return (
    <Pressable
      onPress={() => {
        if (!focused) void Haptics.selectionAsync();
        onPress();
      }}
      onLongPress={onLongPress}
      onPressIn={() => {
        press.value = withSpring(1, PRESS_SPRING);
      }}
      onPressOut={() => {
        press.value = withSpring(0, PRESS_SPRING);
      }}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={styles.item}
    >
      <Animated.View style={[styles.content, contentStyle]}>
        <View style={styles.badgeSlot}>
          <Animated.View style={[styles.badge, styles.tint, tintStyle]} />
          <Animated.View style={[styles.badge, badgeStyle]} />
          <View style={styles.iconStack}>
            <Animated.View style={[styles.iconLayer, restingIconStyle]}>
              {renderIcon(false, colors.faint)}
            </Animated.View>
            <Animated.View style={[styles.iconLayer, activeIconStyle]}>
              {renderIcon(true, colors.fg)}
            </Animated.View>
          </View>
        </View>
        <Animated.Text numberOfLines={1} style={[styles.label, labelStyle]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

export function TabBar({ state, descriptors, navigation }: BottomTabBarProps): ReactElement {
  return (
    /*
     * NO `insets.bottom` HERE — the root layout has already applied it.
     *
     * `app/_layout.tsx` wraps the whole navigator in a `SafeAreaView` with
     * `edges={['top', 'bottom']}`, so by the time this bar renders the navigation bar's height has
     * already been subtracted from the space it is laid out in. Adding `insets.bottom` again
     * padded it TWICE: on a three-button phone that is ~48dp of dead space between the labels and
     * the navigation bar, smaller but still visible on gesture navigation. The root layout's own
     * comment states the rule this violated — individual screens must not add `insets.top` or
     * `insets.bottom` of their own.
     *
     * `space.sm` is the breathing room under the labels, and it is now the whole story: it was
     * already the value used on hardware-key devices, where `insets.bottom` is 0.
     */
    <View style={styles.bar}>
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options ?? {};
        const focused = state.index === index;
        const label =
          typeof options.title === 'string' && options.title.length > 0 ? options.title : route.name;

        return (
          <TabItem
            key={route.key}
            focused={focused}
            label={label}
            renderIcon={(iconFocused, color) =>
              options.tabBarIcon?.({ focused: iconFocused, color, size: ICON_SIZE }) ?? null
            }
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            testID={options.tabBarButtonTestID}
            onPress={() => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              // Re-tapping the active tab must NOT re-navigate — that would reset the screen's
              // own state (a half-filled booking form) under someone who only missed their aim.
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            }}
            onLongPress={() => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.sm,
    // See the note at the render site: the root layout owns the bottom safe-area inset, so this
    // is plain breathing room under the labels and must NOT have `insets.bottom` added to it.
    paddingBottom: space.sm,
    paddingHorizontal: space.sm,
  },
  item: { flex: 1 },
  content: { alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  // Fixed BADGE_SIZE square, not `flex`/`stretch` — this is what keeps the active-tab colour a
  // chip behind the glyph instead of a bar spanning the whole column.
  badgeSlot: { width: BADGE_SIZE, height: BADGE_SIZE, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
  },
  tint: { backgroundColor: colors.bgSunken },
  iconStack: { width: ICON_SIZE, height: ICON_SIZE },
  iconLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  label: {
    ...text.caption,
    fontFamily: fontFamily.semibold,
    fontWeight: '600',
    marginTop: 4,
  },
});
