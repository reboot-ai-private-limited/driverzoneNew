import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  runOnJS,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { MOTION_EASING, motion } from '@/theme/motion';
import { colors, radius, shadow, space } from '@/theme/theme';

/**
 * How long the sheet takes to grow or shrink to new content. Matches `INSET_GLIDE_MS` in
 * `MapCanvas`, so the map's padding and the sheet's top edge move together.
 */
const RESIZE_MS = motion.sheet;
const RESIZE_EASING = MOTION_EASING;

/** The grabber strip's fixed height — see `styles.grabberArea`. */
const GRABBER_HEIGHT = space.sm + 4 + space.md;

/** The two rest positions. */
export type SheetDetent = 'small' | 'large';

interface DraggableSheetProps {
  children: ReactNode;
  /**
   * Which content the sheet is showing — home, the pick list, the pin bar.
   *
   * ONE SHEET, MANY CONTENTS. Changing this does not swap sheets: the same white surface stays
   * on screen, eases to the new content's height, and the old content fades out as the new fades
   * in. Separate sheets per mode used to leave and arrive — overlapping, then sliding out and
   * back — which on a device read as the whole bottom of the screen bouncing.
   */
  contentKey?: string;
  /**
   * False for content with nothing under the fold (the pin bar). The handle is hidden — its strip
   * keeps its height, so the content does not jump — and the sheet cannot be dragged.
   */
  draggable?: boolean;
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
  /**
   * The same "how much of the screen is covered", but LIVE: written on the UI thread on every frame
   * the sheet resizes or is dragged. The map reads it for its padding and crosshair, so they move
   * exactly with the sheet. `onHeightChange` still reports the resting value once per change, for
   * the logic that only needs that.
   */
  visibleHeight?: SharedValue<number>;
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
  contentKey = 'content',
  draggable = true,
  peekHeight = 210,
  initialDetent = 'large',
  detent,
  onDetentChange,
  onHeightChange,
  visibleHeight,
}: DraggableSheetProps): ReactElement {
  /** The sheet's full height at rest: grabber + content + bottom padding. */
  const [height, setHeight] = useState(0);
  /**
   * The visible height of the content area. Eased toward the measured content height, so the
   * sheet grows and shrinks rather than snapping. -1 until the first measurement.
   */
  const contentHeight = useSharedValue(-1);
  const [measured, setMeasured] = useState(false);

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

  /*
   * NEW CONTENT OPENS FULLY. A sheet dragged down to its peek on the home screen must not open
   * the pick list half-hidden; the new height arrives with the content's own layout below.
   */
  const firstContent = useRef(true);
  useEffect(() => {
    if (firstContent.current) {
      firstContent.current = false;
      return;
    }
    offset.value = withTiming(0, { duration: RESIZE_MS, easing: RESIZE_EASING });
  }, [contentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * The content's natural height changed — new content, or a notice appearing inside it. Eases
   * the visible area to it and re-reports the sheet's size to the caller (the map pads from it).
   */
  function onContentLayout(natural: number): void {
    if (natural <= 0) return;

    if (contentHeight.value < 0) {
      // First measurement: no motion — the entering animation is already covering this frame.
      contentHeight.value = natural;
      setMeasured(true);
    } else {
      contentHeight.value = withTiming(natural, { duration: RESIZE_MS, easing: RESIZE_EASING });
    }

    const total = GRABBER_HEIGHT + natural + SHEET_PADDING_BOTTOM;
    setHeight(total);

    const max = draggable ? Math.max(0, total - peekHeight) : 0;
    maxOffset.value = max;

    if (!settled.current) {
      settled.current = true;
      offset.value = offsetFor(initialDetent);
    } else if (offset.value > max) {
      offset.value = max;
    }

    // The TARGET size, reported at once: the map's padding glides there on its own, over the
    // same duration, so the two arrive together.
    reportVisible(total, Math.min(offset.value, max));
  }

  const pan = Gesture.Pan()
    .enabled(draggable)
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

  const contentAreaStyle = useAnimatedStyle(() => ({
    height: Math.max(0, contentHeight.value),
  }));

  // Publishes the live covered height — see `visibleHeight`. Runs on the UI thread only.
  useAnimatedReaction(
    () =>
      contentHeight.value < 0
        ? 0
        : Math.max(0, GRABBER_HEIGHT + contentHeight.value + SHEET_PADDING_BOTTOM - offset.value),
    (covered) => {
      if (visibleHeight !== undefined) visibleHeight.value = covered;
    },
  );

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
      // Only the sheet's FIRST appearance animates here. It stays mounted after that — a change of
      // content is handled inside it (see `contentKey`), never by a new sheet arriving.
      entering={FadeInDown.duration(RESIZE_MS).easing(RESIZE_EASING)}
    >
      <Animated.View style={[styles.sheet, animatedStyle]}>
        {/*
        THE DRAG HANDLE IS THE GRABBER, NOT THE WHOLE SHEET, and that is a fix rather than a
        preference. A pan gesture covering the sheet swallowed every vertical drag inside it —
        so the saved-places list underneath could never scroll: each swipe moved the sheet
        instead. Two vertical gestures cannot share the same finger on the same area, so the
        sheet gets the strip that exists to be grabbed and the content keeps its own scrolling.
      */}
        <GestureDetector gesture={pan}>
          <View style={styles.grabberArea}>
            <View style={[styles.grabber, !draggable && styles.grabberHidden]} />
          </View>
        </GestureDetector>

        {/*
          THE CONTENT AREA: a clip whose height eases to the content's, around a measuring view
          laid out at the content's natural height. The sheet's own height (and its rounded top
          edge) follows the clip, so it grows and shrinks smoothly instead of snapping.

          Before the first measurement the clip has no height of its own, so the content renders
          naturally on the very first frame rather than starting collapsed.
        */}
        <Animated.View style={[styles.contentClip, measured && contentAreaStyle]}>
          <View
            style={styles.contentGutter}
            onLayout={(event) => onContentLayout(event.nativeEvent.layout.height)}
          >
            {/*
              KEYED BY `contentKey`: new content fades in a beat after the old fades out, inside
              the same surface. The old one is gone almost before the new is visible, so the two
              never read as one block of text printed over another.
            */}
            <Animated.View
              key={contentKey}
              entering={FadeIn.delay(70).duration(motion.layout).easing(RESIZE_EASING)}
              exiting={FadeOut.duration(90)}
            >
              {children}
            </Animated.View>
          </View>
        </Animated.View>

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

/**
 * `sm`: the root `SafeAreaView` in `app/_layout.tsx` already insets the whole navigator above the
 * gesture bar, so this is purely the breathing room below the last line — a tight gap is all it
 * needs, anything more was the single largest empty stretch in the sheet.
 */
const SHEET_PADDING_BOTTOM = space.sm;

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingBottom: SHEET_PADDING_BOTTOM,
    ...shadow.card,
  },
  // Clips content that is taller than the area while it eases open; the measuring view inside
  // keeps the content's natural height regardless.
  contentClip: { overflow: 'hidden' },
  /*
   * THE SIDE GUTTER LIVES INSIDE THE CLIP, not on the sheet. With it on the sheet the clip was
   * exactly as wide as the cards, so every card shadow (the Destination box most visibly) was
   * sliced off flat at its left and right edges. Inside, the clip spans the full sheet and the
   * gutter is room for those shadows to draw in.
   */
  contentGutter: { paddingHorizontal: space.lg },
  grabberHidden: { opacity: 0 },
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
