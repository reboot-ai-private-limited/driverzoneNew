import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '@/theme/theme';

/**
 * The pale city silhouette behind the login card. Decorative only — `pointerEvents="none"` and
 * no accessibility role, because a screen reader announcing "skyline" adds nothing and a
 * customer using one still has to reach the number field.
 *
 * Drawn as rectangles rather than shipped as an image so it inherits the wash colour from the
 * theme and costs no download.
 */
export function Skyline({ height = 220 }: { height?: number }): ReactElement {
  return (
    <View style={[styles.root, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 320 160" preserveAspectRatio="xMidYMax slice">
        <Circle cx="46" cy="24" r="9" fill={colors.brandWash} />
        <Circle cx="58" cy="24" r="12" fill={colors.brandWash} />
        <Circle cx="72" cy="25" r="8" fill={colors.brandWash} />
        <Circle cx="250" cy="18" r="8" fill={colors.brandWash} />
        <Circle cx="262" cy="18" r="11" fill={colors.brandWash} />

        <Rect x="8" y="96" width="26" height="64" fill={colors.brandWash} />
        <Rect x="38" y="72" width="30" height="88" fill={colors.brandWash} />
        <Rect x="72" y="108" width="22" height="52" fill={colors.brandWash} />
        <Rect x="98" y="56" width="34" height="104" fill={colors.brandWash} />
        <Path d="M136 60 L152 40 L168 60 L168 160 L136 160 Z" fill={colors.brandWash} />
        <Rect x="172" y="84" width="28" height="76" fill={colors.brandWash} />
        <Rect x="204" y="66" width="32" height="94" fill={colors.brandWash} />
        <Rect x="240" y="100" width="24" height="60" fill={colors.brandWash} />
        <Rect x="268" y="78" width="30" height="82" fill={colors.brandWash} />
        <Rect x="302" y="104" width="18" height="56" fill={colors.brandWash} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
