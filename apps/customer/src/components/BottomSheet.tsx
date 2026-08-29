import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
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

  /** 0 = closed, 1 = open. One value drives both surfaces so they can never disagree. */
  const progress = useRef(new Animated.Value(0)).current;

  /**
   * Measured, not assumed: translating by a guessed distance either leaves a strip of the sheet
   * on screen before it opens, or makes a short sheet travel further than it should and arrive
   * too fast. The default only applies to the first frame, before layout has run.
   */
  const [height, setHeight] = useState(360);

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
      const frame = requestAnimationFrame(() => {
        Animated.timing(progress, {
          toValue: 1,
          duration: 260,
          // Decelerating: fast off the mark, settling at the end — the standard for something
          // arriving on screen.
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });

      return () => cancelAnimationFrame(frame);
    }

    Animated.timing(progress, {
      toValue: 0,
      // Leaving is quicker than arriving. A dismissal that takes as long as an entrance feels
      // like the app is arguing with the tap.
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Only unmount on a COMPLETED exit: an animation interrupted by a re-open would otherwise
      // tear down the sheet that is in the middle of coming back.
      if (finished) setMounted(false);
    });

    return undefined;
  }, [visible, progress]);

  if (!mounted) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height, 0],
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
        <Animated.View style={[styles.backdrop, { opacity: progress }]} pointerEvents="none" />

        {/* Tapping off the sheet closes it. Separate from the backdrop view so the fade can run
            with `pointerEvents="none"` and never swallow a tap mid-animation. */}
        <Pressable style={styles.dismissArea} onPress={onClose} accessibilityLabel="Close" />

        <Animated.View
          style={[
            styles.sheet,
            { paddingBottom: insets.bottom + space.lg, transform: [{ translateY }] },
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
