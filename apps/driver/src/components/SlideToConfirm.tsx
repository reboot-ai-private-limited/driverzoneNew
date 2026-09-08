import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { type ReactElement, useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, space, text } from '@/theme/theme';

/**
 * SLIDE TO CONFIRM — the control that ends a trip.
 *
 * A button, deliberately not. Ending a trip writes the ledger, closes the fare and is the one
 * action on this screen that cannot be taken back; it also sits under a driver's thumb for the
 * whole ride, in a pocket, against a steering wheel. A tap target there gets hit by accident, and
 * a confirm dialog answers that by making every DELIBERATE end two taps. A slide is the standard
 * answer: impossible to trigger by brushing, one gesture when you mean it.
 *
 * **The gesture runs entirely on the UI thread.** The knob tracks the finger through a Reanimated
 * shared value, so it stays glued to the touch even while the JS thread is busy with a poll or a
 * re-render — the exact moment a janky slider would feel broken. Only the outcomes cross back to
 * JS, through `runOnJS`.
 *
 * Three things make it feel like a physical control rather than a progress bar:
 *
 *   - it SNAPS BACK with a spring when released short of the end, so an aborted slide is
 *     obviously an abort rather than a state you have to undo,
 *   - the hint arrows breathe left-to-right on a loop, which is what tells a first-time driver
 *     this is draggable at all, and they stop the instant the knob is picked up,
 *   - haptics fire on grab and again on commit, so the commit is felt without looking down.
 */

/** How far along the track counts as committed. Not 100%: the last few pixels are unreachable. */
const COMMIT_FRACTION = 0.9;

const KNOB = 58;
const TRACK_HEIGHT = 66;
const PADDING = 4;

interface SlideToConfirmProps {
  label: string;
  onConfirm: () => void;
  /** Freezes the control and shows a spinner in the knob while the action is in flight. */
  loading?: boolean;
  disabled?: boolean;
  /** The filled portion and the knob. Defaults to the on-duty green. */
  tint?: string;
}

export function SlideToConfirm({
  label,
  onConfirm,
  loading = false,
  disabled = false,
  tint = colors.dutyOn,
}: SlideToConfirmProps): ReactElement {
  /** How far the knob has travelled, in px. The single source of truth for every animation here. */
  const offset = useSharedValue(0);
  /** Track width, measured rather than assumed — this control is full-width on any handset. */
  const travel = useSharedValue(0);
  const grabbed = useSharedValue(0);
  /** Drives the breathing hint. Stopped while grabbed, and never started when inert. */
  const hint = useSharedValue(0);

  const inert = loading || disabled;

  useEffect(() => {
    if (inert) {
      hint.value = 0;
      return;
    }
    hint.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.quad) }),
      -1,
      false,
    );
  }, [inert, hint]);

  // A completed slide must not spring back while the request is in flight — that reads as the
  // gesture not having registered. It resets only if the action fails and `loading` goes false
  // again with the knob still out.
  useEffect(() => {
    if (!loading) offset.value = withSpring(0, { damping: 18, stiffness: 180 });
  }, [loading, offset]);

  function commit(): void {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm();
  }

  function grab(): void {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const pan = Gesture.Pan()
    .enabled(!inert)
    .onBegin(() => {
      grabbed.value = 1;
      runOnJS(grab)();
    })
    .onUpdate((event) => {
      // Clamped on the UI thread, so the knob can never be dragged outside its track even for a
      // single frame.
      offset.value = Math.max(0, Math.min(travel.value, event.translationX));
    })
    .onEnd(() => {
      grabbed.value = 0;
      if (travel.value > 0 && offset.value >= travel.value * COMMIT_FRACTION) {
        // Park it at the end and hand off; the `loading` effect above keeps it there.
        offset.value = withSpring(travel.value, { damping: 20, stiffness: 200 });
        runOnJS(commit)();
        return;
      }
      offset.value = withSpring(0, { damping: 18, stiffness: 180 });
    })
    .onFinalize(() => {
      grabbed.value = 0;
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offset.value },
      { scale: withSpring(grabbed.value === 1 ? 1.05 : 1, { damping: 16, stiffness: 220 }) },
    ],
  }));

  /** The trail behind the knob — it fills as you go, so progress is visible without a separate bar. */
  const fillStyle = useAnimatedStyle(() => ({
    width: offset.value + KNOB + PADDING,
  }));

  /**
   * The label fades out as the knob covers it. Tied to actual travel rather than a timer, so it
   * tracks the finger exactly — including on the way back if the driver changes their mind.
   */
  const labelStyle = useAnimatedStyle(() => ({
    opacity:
      travel.value === 0 ? 1 : interpolate(offset.value, [0, travel.value * 0.55], [1, 0], 'clamp'),
  }));

  const hintStyle = useAnimatedStyle(() => ({
    opacity: grabbed.value === 1 ? 0 : interpolate(hint.value, [0, 0.5, 1], [0.25, 0.9, 0.25]),
    transform: [{ translateX: interpolate(hint.value, [0, 1], [0, 10]) }],
  }));

  return (
    <View
      style={[styles.track, inert && styles.trackInert]}
      onLayout={(event) => {
        travel.value = event.nativeEvent.layout.width - KNOB - PADDING * 2;
      }}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityHint="Swipe right to confirm"
      // The whole point of a slider is that a tap does nothing — but a screen reader user gets no
      // gesture at all, so for them the action is a plain activation.
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={() => {
        if (!inert) commit();
      }}
    >
      <Animated.View style={[styles.fill, { backgroundColor: tint }, fillStyle]} />

      <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {label}
      </Animated.Text>

      <Animated.View style={[styles.hint, hintStyle]} pointerEvents="none">
        <Feather name="chevrons-right" size={22} color={colors.muted} />
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.knob, { backgroundColor: tint }, knobStyle]}>
          {loading ? (
            <ActivityIndicator color={colors.onFg} />
          ) : (
            <Feather name="chevron-right" size={26} color={colors.onFg} />
          )}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    padding: PADDING,
    overflow: 'hidden',
  },
  trackInert: { opacity: 0.6 },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: TRACK_HEIGHT / 2,
    opacity: 0.18,
  },
  label: {
    ...text.body,
    fontWeight: '700',
    color: colors.fg,
    textAlign: 'center',
    // Sits behind the knob rather than beside it, so the knob visibly slides OVER the words.
    position: 'absolute',
    left: KNOB,
    right: space.lg,
  },
  hint: { position: 'absolute', right: space.md },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
