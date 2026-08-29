import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, radius, shadow, space } from '@/theme/theme';

interface DraggableSheetProps {
  children: ReactNode;
  /**
   * How much of the sheet stays on screen when collapsed. Enough for the grabber, the pickup
   * line and the destination field — collapsing past the primary control would be hiding the
   * thing the screen is for.
   */
  peekHeight?: number;
  /**
   * The desired state, for callers that need to collapse it themselves — "Select on map" has to
   * get the sheet out of the way to mean anything.
   *
   * CONTROLLED-ISH on purpose: the gesture still moves the sheet directly and reports back via
   * `onCollapsedChange`, so a parent that mirrors the value stays in step. Routing the drag
   * itself through parent state would put a React render between the finger and the sheet,
   * which is the lag this component exists to avoid.
   */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** The measured full height, so a caller can tell the map how much of it is covered. */
  onHeightChange?: (height: number) => void;
}

/**
 * The home sheet: draggable between EXPANDED (all of it) and COLLAPSED (a peek, with more map
 * showing).
 *
 * Reanimated and `react-native-gesture-handler` rather than `PanResponder` and `Animated`,
 * because a sheet that follows a finger has to update per frame: the JS-driven pair does that
 * work on the JS thread, and this screen's thread is busy with reverse geocoding and a coverage
 * query at exactly the moment a customer grabs the handle. Both libraries are already
 * dependencies, and `babel-preset-expo` wires the worklet transform.
 *
 * The travel distance is MEASURED, not fixed: content height changes with the number of saved
 * places and with whether a coverage notice is showing, and a hardcoded offset would leave the
 * sheet either short of the bottom or dragged past it.
 */
export function DraggableSheet({
  children,
  peekHeight = 210,
  collapsed,
  onCollapsedChange,
  onHeightChange,
}: DraggableSheetProps): ReactElement {
  const [height, setHeight] = useState(0);

  /** Current offset in points: 0 is fully expanded, `maxOffset` is collapsed to the peek. */
  const offset = useSharedValue(0);
  /** Where the drag started, so movement is relative rather than absolute. */
  const start = useSharedValue(0);
  const maxOffset = useSharedValue(0);

  useEffect(() => {
    if (collapsed === undefined) return;
    offset.value = withSpring(collapsed ? maxOffset.value : 0, SPRING);
  }, [collapsed, offset, maxOffset]);

  const pan = Gesture.Pan()
    // Vertical only, and only past a few points: a horizontal swipe or a tap on a row inside
    // the sheet must not become a drag.
    .activeOffsetY([-6, 6])
    .failOffsetX([-20, 20])
    .onStart(() => {
      start.value = offset.value;
    })
    .onUpdate((event) => {
      const next = start.value + event.translationY;
      offset.value = Math.min(Math.max(next, 0), maxOffset.value);
    })
    .onEnd((event) => {
      // Velocity wins over position: a deliberate flick should finish the gesture even from
      // barely past the start, which is how every sheet on the platform behaves.
      const next =
        event.velocityY > 500
          ? true
          : event.velocityY < -500
            ? false
            : offset.value > maxOffset.value / 2;

      // No overshoot in SPRING: a sheet that bounces past its own edge shows the screen behind it.
      offset.value = withSpring(next ? maxOffset.value : 0, SPRING);

      if (onCollapsedChange !== undefined) runOnJS(onCollapsedChange)(next);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  return (
    <Animated.View
      style={[styles.sheet, animatedStyle]}
      onLayout={(event) => {
        const measured = event.nativeEvent.layout.height;
        if (measured <= 0) return;
        setHeight(measured);
        onHeightChange?.(measured);
        maxOffset.value = Math.max(0, measured - peekHeight);
        // A sheet that shrank below where it was already dragged would leave a gap under it.
        if (offset.value > maxOffset.value) offset.value = maxOffset.value;
      }}
    >
      {/*
        THE DRAG HANDLE IS THE GRABBER, NOT THE WHOLE SHEET, and that is a fix rather than a
        preference. A pan gesture covering the sheet swallowed every vertical drag inside it —
        so the saved-places list underneath could never scroll: each swipe moved the sheet
        instead. Two vertical gestures cannot share the same finger on the same area, so the
        sheet gets the strip that exists to be grabbed and the content keeps its own scrolling.
      */}
      <GestureDetector gesture={pan}>
        <View style={styles.grabberArea}>
          <View style={styles.grabber} />
        </View>
      </GestureDetector>

      {children}

      {/*
          Fills whatever the sheet exposes below itself once dragged down. Without it the sheet's
          own background stops at its content and the map shows through beneath a sheet that is
          supposed to be anchored to the bottom edge.
        */}
      <View style={[styles.tail, { height: Math.max(0, height) }]} />
    </Animated.View>
  );
}

const SPRING = { damping: 20, stiffness: 180, overshootClamping: true } as const;

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    // `md`, not `lg`: the root `SafeAreaView` in `app/_layout.tsx` already insets the whole
    // navigator above the gesture bar, so this is purely the breathing room below Continue —
    // and at `lg` it was the single largest gap in the sheet.
    paddingBottom: space.md,
    ...shadow.card,
  },
  // Taller than the bar it contains: it is the only drag target now, so it needs a real height.
  grabberArea: { paddingTop: space.sm, paddingBottom: space.md, alignItems: 'center' },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  tail: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    backgroundColor: colors.bg,
  },
});
