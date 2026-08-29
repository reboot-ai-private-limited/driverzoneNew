import { BlurView } from 'expo-blur';
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '@/theme/theme';

interface GlassPanelProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 0–100. Higher frosts more; the map underneath should still read as a map. */
  intensity?: number;
  rounded?: 'pill' | 'card';
}

/**
 * A frosted surface for the controls that FLOAT OVER THE MAP.
 *
 * Only over the map. Glass is a relationship between two layers — it shows what is behind it —
 * so a blurred panel on a flat white sheet is an expensive way to draw grey. Everything inside
 * the bottom sheet stays opaque.
 *
 * **On Android this is translucency, not blur, and that is deliberate.** Android has no system
 * backdrop blur before API 31, and expo-blur's `dimezisBlurView` workaround now requires a
 * `blurTarget` — an explicit `<BlurTarget>` wrapping the content to be sampled, with its ref
 * handed to the `BlurView`. Passing the method without a target makes the library log
 * *"will fallback to 'none' blur method"* and render nothing, which is what it was doing here.
 *
 * Wiring a real target would mean threading a ref out of `MapCanvas` so the WebView could be
 * sampled — and a snapshot blur over a WebView's own surface is not something to rely on. So the
 * Android path is an honest translucent wash, which over a pale map reads as frosted anyway, and
 * iOS gets the real native blur, which needs no target at all.
 */
export function GlassPanel({
  children,
  style,
  intensity = 55,
  rounded = 'card',
}: GlassPanelProps): ReactElement {
  const shape = rounded === 'pill' ? styles.pill : styles.card;

  return (
    <View style={[styles.wrap, shape, style]}>
      {/* No `experimentalBlurMethod`: without a `blurTarget` it disables itself and logs a
          warning on every mount. iOS blurs natively from this alone. */}
      <BlurView intensity={intensity} tint="light" style={StyleSheet.absoluteFill} />
      {/*
        A wash over the blur, not instead of it. Blur alone leaves dark map features showing
        through at low contrast, and every label on these controls is ink — this is what keeps
        them at a readable contrast over an arbitrary map tile.
      */}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  // `overflow: hidden` is what makes the corner radius clip the blur on Android; without it the
  // blur paints a square behind a rounded panel.
  wrap: { overflow: 'hidden' },
  card: { borderRadius: radius.md },
  pill: { borderRadius: radius.pill },
  wash: { backgroundColor: 'rgba(255,255,255,0.72)' },
  content: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.75)' },
});

/** Exported so callers can match the panel's own edge when they draw a border beside one. */
export const GLASS_EDGE = colors.border;
