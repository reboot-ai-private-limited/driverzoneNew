import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, fontFamily, text } from '@/theme/theme';

interface ProgressRingProps {
  /** 0–100. Clamped, so a caller's arithmetic slip cannot draw a broken arc. */
  percent: number;
  size?: number;
  strokeWidth?: number;
}

/**
 * The completion dial on the profile screen.
 *
 * Drawn with `strokeDasharray`/`strokeDashoffset` on a plain circle rather than an arc path:
 * an arc needs the large-arc and sweep flags recomputed per angle and flips incorrectly at
 * exactly 50%, which is a bug that only appears at one value. Dash offset has no such case.
 *
 * Rotated -90° so the arc starts at twelve o'clock instead of three.
 */
export function ProgressRing({
  percent,
  size = 96,
  strokeWidth = 8,
}: ProgressRingProps): ReactElement {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <View
      style={{ width: size, height: size }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: clamped }}
      accessibilityLabel="Profile completion"
    >
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={colors.brand}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          // SVG angles start at three o'clock; the dial reads as progress only from the top.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>

      <View style={styles.label} pointerEvents="none">
        <View style={styles.valueRow}>
          <Text style={styles.value}>{clamped}</Text>
          <Text style={styles.unit}>%</Text>
        </View>
        <Text style={styles.caption}>Complete</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Written out rather than `StyleSheet.absoluteFillObject`, which React Native 0.86's types no
  // longer expose. `absoluteFill` is a registered style ID, not an object, so it cannot be spread.
  label: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `baseline` so the smaller % sits on the number's baseline rather than its centre.
  valueRow: { flexDirection: 'row', alignItems: 'baseline' },
  value: { fontSize: 22, fontWeight: '800', fontFamily: fontFamily.extrabold, color: colors.fg },
  unit: { fontSize: 13, fontWeight: '700', fontFamily: fontFamily.bold, color: colors.fg },
  caption: { ...text.caption, color: colors.muted, marginTop: -1 },
});
