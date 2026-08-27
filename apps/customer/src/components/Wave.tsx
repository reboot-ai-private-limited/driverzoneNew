import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme/theme';

/**
 * The brand's curved edge, where a yellow field meets white.
 *
 * SVG rather than a border radius: the curve in the approved screens is asymmetric — it rises
 * further on one side — and no combination of corner radii produces that. A single `Path` also
 * scales to any device width without the shape distorting, which a background image would not.
 *
 * `viewBox` is a fixed 100x100 with `preserveAspectRatio="none"`, so the path is written once in
 * percentages and stretched to whatever height the caller asks for.
 */
export function WaveBottom({
  height = 120,
  color = colors.brand,
}: {
  height?: number;
  color?: string;
}): ReactElement {
  return (
    <View style={[styles.bottom, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Path d="M0 32 C 22 4, 46 46, 68 30 C 82 20, 92 22, 100 26 L100 100 L0 100 Z" fill={color} />
      </Svg>
    </View>
  );
}

/** The same curve inverted, closing the bottom edge of the OTP screen's yellow header. */
export function WaveHeaderEdge({
  height = 56,
  color = colors.brand,
}: {
  height?: number;
  color?: string;
}): ReactElement {
  return (
    <View style={{ height, marginTop: -1 }} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Path d="M0 0 L100 0 L100 34 C 74 92, 26 92, 0 34 Z" fill={color} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
