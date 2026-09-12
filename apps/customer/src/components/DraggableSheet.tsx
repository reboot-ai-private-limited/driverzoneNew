import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  FadeOut,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, radius, shadow, space } from '@/theme/theme';

/** The two rest positions. */
export type SheetDetent = 'small' | 'large';

interface DraggableSheetProps {
  children: ReactNode;
  /**
   * SMALL: how much of the sheet stays on screen at its lower rest position. Enough for the
   * grabber, the pickup line and the destination field — a rest position that hid the primary
   * control would be hiding the thing the screen is for.
   */
  peekHeight?: number;
  /** Which detent the sheet settles at on first layout. Defaults to `large`. */
  initialDetent?: SheetDetent;
  /**
   * The desired detent, for callers that need to move the sheet themselves — "Select on map"
   * has to get it out of the way to mean anything.
   *
   * CONTROLLED-ISH on purpose: the gesture still moves the sheet directly and reports back via
   * `onDetentChange`, so a parent that mirrors the value stays in step. Routing the drag itself
   * through parent state would put a React render between the finger and the sheet, which is the
   * lag this component exists to avoid.
   */
  detent?: SheetDetent;
  onDetentChange?: (detent: SheetDetent) => void;
  /**
   * How much of the screen the sheet is COVERING right now — the measured height minus however
   * far it has been dragged down, not the measured height on its own.
   *
   * THAT DISTINCTION IS THE WHOLE POINT, and reporting the raw measurement was a real bug. The
   * caller feeds this straight to the map as `bottomInset`, which becomes the map's own padding
   * AND the bottom edge-padding `fitToCoordinates` frames a route inside. A sheet dragged down to
   * its peek still reported its full height, so the map believed several hundred points more were
   * hidden than actually were: the crosshair drifted off the point it was reporting, and framing a
   * pickup/drop pair had almost no room left to put them in.
   */
  onHeightChange?: (visibleHeight: number) => void;
}

/**
 * The home sheet: draggable between two rest positions — LARGE (all of it) and SMALL (a peek,
 * with more map showing).
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
  initialDetent = 'large',
  detent,
  onDetentChange,
  onHeightChange,
}: DraggableSheetProps): ReactElement {
  const [height, setHeight] = useState(0);

  /** Current offset in points: 0 is fully expanded (LARGE), `maxOffset` is the peek (SMALL). */
  const offset = useSharedValue(0);
  /** Where the drag started, so movement is relative rather than absolute. */
  const start = useSharedValue(0);
  const maxOffset = useSharedValue(0);

  /** The default detent is applied once, on the first real measurement — not on every relayout. */
  const settled = useRef(false);

  /** Offset for a named detent. Called only from the JS thread (effect + layout). */
  function offsetFor(which: SheetDetent): number {
    return which === 'small' ? maxOffset.value : 0;
  }

  /**
   * Tells the caller how much of the screen is covered, from an offset.
   *
   * ONE FUNCTION, CALLED FROM ALL THREE PLACES THE SHEET CAN MOVE — first layout, a relayout, and
   * the end of a drag. The map's framing depends on this being current, and three separate
   * subtractions is how one of them ends up reporting the full height again.
   */
  function reportVisible(measured: number, atOffset: number): void {
    onHeightChange?.(Math.max(0, measured - atOffset));
  }

  /** The JS-thread half of a finished drag: tell the caller where it landed, and how tall it is. */
  function settleTo(which: SheetDetent, measured: number, atOffset: number): void {
    onDetentChange?.(which);
    reportVisible(measured, atOffset);
  }

  useEffect(() => {
    if (detent === undefined) return;
    const next = offsetFor(detent);
    offset.value = withSpring(next, SPRING);
    reportVisible(height, next);
  }, [detent]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const toSmall =
        event.velocityY > 500
          ? true
          : event.velocityY < -500
            ? false
            : offset.value > maxOffset.value / 2;

      // No overshoot in SPRING: a sheet that bounces past its own edge shows the screen behind it.
      const landing = toSmall ? maxOffset.value : 0;
      offset.value = withSpring(landing, SPRING);

      /*
       * Reported from the LANDING offset, not from where the finger let go. The map re-pads
       * itself from this, and padding it to a position the sheet is still springing away from
       * would leave the inset wrong for good — nothing reports again once the spring settles.
       */
      runOnJS(settleTo)(toSmall ? 'small' : 'large', height, landing);
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: offset.value }],
  }));

  return (
    /*
      TWO VIEWS, ONE SHEET, AND THEY CANNOT BE MERGED.

      The wrapper owns the enter/exit; the inner view owns the drag. Both animate `transform` —
      `FadeInDown` slides the sheet up by translating it, and the pan writes `translateY` every
      frame — so with the two on one component Reanimated warns that the layout animation may
      overwrite the style, and it is right: for the length of the entrance the entering animation
      and the gesture are writing the same property, and whichever lands last wins the frame.

      Splitting them is the documented remedy, not a workaround. The wrapper carries no styles of
      its own, so it adds a node to the tree and nothing to the layout.
    */
    <Animated.View
      // When one sheet swaps for another (idle ⇄ picking) the incoming one rises into place
      // instead of the content blinking over. The outgoing one only fades — an opacity-only
      // exit keeps its layout box from shoving the controls above it around while it leaves.
      entering={FadeInDown.springify().damping(22).stiffness(170).mass(0.9)}
      exiting={FadeOut.duration(140)}
    >
      <Animated.View
        style={[styles.sheet, animatedStyle]}
        onLayout={(event) => {
          const measured = event.nativeEvent.layout.height;
          if (measured <= 0) return;
          setHeight(measured);

          const max = Math.max(0, measured - peekHeight);
          maxOffset.value = max;

          if (!settled.current) {
            // First measurement: drop straight onto the default detent, no motion — the entering
            // animation above is already covering this frame.
            settled.current = true;
            offset.value = offsetFor(initialDetent);
          } else if (offset.value > max) {
            // A later relayout shrank the sheet below where it was dragged; close the gap.
            offset.value = max;
          }

          // AFTER the offset is decided, never before: a report taken above would describe the
          // previous position, and on the very first layout there is no previous position at all.
          reportVisible(measured, offset.value);
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
    </Animated.View>
  );
}

// Softer than a snap: enough stiffness to feel responsive, enough damping that it eases into
// its stop rather than arriving with a jolt. Clamped so it never travels past either end.
const SPRING = {
  damping: 24,
  stiffness: 165,
  mass: 1,
  overshootClamping: true,
  restDisplacementThreshold: 0.1,
  restSpeedThreshold: 0.1,
} as const;

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    // `sm`: the root `SafeAreaView` in `app/_layout.tsx` already insets the whole navigator
    // above the gesture bar, so this is purely the breathing room below the last line — a tight
    // gap is all it needs, anything more was the single largest empty stretch in the sheet.
    paddingBottom: space.sm,
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
