import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, space } from '@/theme/theme';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A panel that rises from the bottom edge over a dimmed screen.
 *
 * **Why this is not just `<Modal animationType="slide">`.** That prop animates the ENTIRE modal
 * window, and on a `transparent` modal the window includes the dark backdrop — so the scrim flies
 * up from the bottom edge with the sheet, which reads as a black rectangle being thrown at the
 * screen. The two surfaces have to move differently: the backdrop FADES in place, the sheet
 * TRANSLATES. That needs `animationType="none"` and the motion done here.
 *
 * Both animated properties — `opacity` and `translateY` — are ones the native driver supports, so
 * the animation runs on the UI thread and stays smooth while JavaScript is busy. That matters
 * here: this sheet often opens on the same tap that fires a query.
 */
export function BottomSheet({ visible, onClose, children }: BottomSheetProps): ReactElement | null {
  const insets = useSafeAreaInsets();

  /**
   * Mounting is NOT the same as visibility, and conflating them is what makes a closing sheet
   * vanish instantly. `visible` goes false immediately; this stays true until the exit animation
   * has actually finished, and only then unmounts the modal.
   */
  const [mounted, setMounted] = useState(visible);

  /**
   * Two values, not one: the sheet rides a SPRING (a little life as it settles), the backdrop
   * rides a TIMING (a flat fade — a scrim that springs looks like a flicker). Sharing one value
   * would force both onto the same curve.
   */
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;

  /**
   * Measured, not assumed: translating by a guessed distance either leaves a strip of the sheet
   * on screen before it opens, or makes a short sheet travel further than it should and arrive
   * too fast. The default only applies to the first frame, before layout has run.
   */
  const [height, setHeight] = useState(360);

  /**
   * How much of the screen the keyboard is covering, and why this is done by hand.
   *
   * A `Modal` is hoisted into its OWN window by the platform, outside the activity whose
   * `windowSoftInputMode=adjustResize` normally shrinks the app around the keyboard. So the sheet
   * — anchored to the bottom edge — keeps sitting exactly where the keyboard now is, and any
   * field near its foot is typed into blind. `KeyboardAvoidingView` does not rescue it either: it
   * measures the frame it is inside, and inside a modal window that frame never changed.
   *
   * Tracking the height directly and lifting the sheet by it is the one approach that does not
   * depend on the modal participating in the activity's resize. Copied from the driver app's
   * sheet, which had this from the start — this one did not, which is why the cancel sheet's
   * "Other reason" box sat behind the keyboard.
   */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: screenHeight } = useWindowDimensions();

  useEffect(() => {
    // iOS emits `will*` ahead of the animation, so the sheet travels WITH the keyboard rather
    // than snapping after it. Android only ever emits `did*`.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) =>
      setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setMounted(true);

      /**
       * THE ANIMATION HAS TO START AFTER THE MOUNT, and this frame's delay is the whole fix.
       *
       * `setMounted(true)` does not take effect until the next render, so this component is
       * still returning `null` on the line above. Starting the timing here ran it against a
       * view that did not exist yet — by the time the sheet actually mounted the value had
       * already reached 1, and the sheet appeared fully open with no motion at all. Which is
       * exactly what "the modal does not open and close" looks like.
       *
       * Resetting to 0 matters for the same reason a re-open after an interrupted close would
       * otherwise begin from wherever the previous animation stopped.
       */
      progress.setValue(0);
      fade.setValue(0);
      const frame = requestAnimationFrame(() => {
        Animated.parallel([
          // A plain ease-out glide — no spring, so nothing can overshoot or bounce.
          Animated.timing(progress, {
            toValue: 1,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(fade, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
      });

      return () => cancelAnimationFrame(frame);
    }

    // Leaving is quicker than arriving, and it is a plain glide — no spring on the way out, a
    // dismissal that takes as long as an entrance feels like the app is arguing with the tap.
    Animated.parallel([
      Animated.timing(progress, {
        toValue: 0,
        duration: 190,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fade, {
        toValue: 0,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      // Only unmount on a COMPLETED exit: an animation interrupted by a re-open would otherwise
      // tear down the sheet that is in the middle of coming back.
      if (finished) setMounted(false);
    });

    return undefined;
  }, [visible, progress, fade]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height, 0],
    extrapolate: 'clamp',
  });

  // A few points of rise as it lands — the difference between a panel that slides in and one
  // that is simply pasted at the bottom. Clamped so a spring overshoot never scales it past 1.
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.98, 1],
    extrapolate: 'clamp',
  });

  return (
    <Modal
      visible
      transparent
      // The motion is ours, above. Leaving this at 'slide' would animate the backdrop too.
      animationType="none"
      // Without this the backdrop stops at the status bar on Android and leaves a bright strip
      // above a dimmed screen.
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: fade }]} pointerEvents="none" />

        {/* Tapping off the sheet closes it. Separate from the backdrop view so the fade can run
            with `pointerEvents="none"` and never swallow a tap mid-animation. */}
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close" />

        <Animated.View
          style={[
            styles.sheet,
            {
              // Lifted clear of the keyboard. `marginBottom` rather than padding: the sheet has to
              // MOVE, not grow — growing would push its top off screen and leave the foot exactly
              // where it was, still covered.
              marginBottom: keyboardHeight,

              /**
               * The home inset only matters when nothing else is down there. With the keyboard up
               * it sits above the gesture bar, so adding the inset too would leave a strip of dead
               * space between the sheet and the keys.
               */
              paddingBottom: keyboardHeight > 0 ? space.lg : insets.bottom + space.lg,

              /**
               * With the keyboard up there may not be room for the whole sheet. Capping the height
               * lets a ScrollView inside take over — without this the sheet simply grows past the
               * top of the screen and its heading becomes unreachable.
               */
              maxHeight: screenHeight - keyboardHeight - insets.top - space.xl,

              transform: [{ translateY }, { scale }],
            },
          ]}
          onLayout={(event) => {
            const measured = event.nativeEvent.layout.height;
            if (measured > 0) setHeight(measured);
          }}
        >
          <View style={styles.grabber} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  dismissArea: { flex: 1 },

  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: space.md,
  },
});
