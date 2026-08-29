import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement, ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius } from '@/theme/theme';

interface GlassPanelProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** 0–100. Higher frosts more; the map underneath should still read as a map. */
  intensity?: number;
  rounded?: 'pill' | 'card';
  /**
   * "Liquid glass": a much thinner wash so the map bleeds through, heavier blur, a top-lit
   * vertical gradient, a hard specular strip on the top edge and a rim that is bright above
   * and faintly dark below — the light on the pane, not just the frost behind it. Use for the
   * one hero surface on screen (the search field), not every chip.
   */
  liquid?: boolean;
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
  liquid = false,
}: GlassPanelProps): ReactElement {
  const shape = rounded === 'pill' ? styles.pill : styles.card;

  return (
    <View style={[styles.wrap, shape, style]}>
      {/* No `experimentalBlurMethod`: without a `blurTarget` it disables itself and logs a
          warning on every mount. iOS blurs natively from this alone. */}
      <BlurView
        intensity={liquid ? Math.min(intensity + 35, 100) : intensity}
        tint="light"
        style={StyleSheet.absoluteFill}
      />
      {/*
        A wash over the blur, not instead of it. Blur alone leaves dark map features showing
        through at low contrast, and every label on these controls is ink — this is what keeps
        them at a readable contrast over an arbitrary map tile. The liquid wash is much thinner,
        so the gradients below have to carry both the depth cue and the readability.
      */}
      <View style={[StyleSheet.absoluteFill, liquid ? styles.washLiquid : styles.wash]} />
      {liquid ? (
        <>
          {/*
            Lit from above: a vertical fall from a bright top to a dim middle and a faint
            pick-up at the base is how a real curved pane catches a sky. A flat wash never
            reads as glass no matter how transparent it is — the light has to have a direction.
          */}
          <LinearGradient
            colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.28)']}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {/* The specular strip: a hard highlight hugging the very top edge, the single cue
              that most sells "polished glass" rather than "translucent plastic". */}
          <LinearGradient
            colors={['rgba(255,255,255,0.95)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.sheen}
            pointerEvents="none"
          />
        </>
      ) : null}
      <View style={[styles.content, liquid && styles.contentLiquid]}>{children}</View>
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
  washLiquid: { backgroundColor: 'rgba(255,255,255,0.30)' },
  content: { borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.75)' },
  // A thick pane lit from above: a near-white top edge, a body rim that only half-catches the
  // light, and a faint dark base so the glass has a bottom, not just a fade.
  contentLiquid: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    borderTopColor: 'rgba(255,255,255,0.95)',
    borderBottomColor: 'rgba(120,120,130,0.25)',
  },
  sheen: { position: 'absolute', left: 0, right: 0, top: 0, height: 16 },
});

/** Exported so callers can match the panel's own edge when they draw a border beside one. */
export const GLASS_EDGE = colors.border;
