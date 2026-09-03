import { LOGO_SVG } from '@driverzone/mobile-ui/logo';
import type { ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { colors, fontFamily, radius, space } from '@/theme/theme';

/** The mark's own aspect ratio, from its viewBox (236 × 126). */
const ASPECT = 126 / 236;

interface LogoProps {
  width?: number;
  /**
   * The "DRIVER" pill beside the mark.
   *
   * Not decoration: a driver may well have the customer app installed too, and the two are the
   * same wordmark in the same yellow and black. On the screens where someone is deciding which
   * app they are looking at — the boot screen and sign-in — the pill is what tells them apart.
   * Off everywhere else, where the surrounding UI already makes it obvious.
   */
  showBadge?: boolean;
}

/**
 * The DriverZone logo — the same artwork the customer app and the admin panel use, from
 * `@driverzone/mobile-ui/logo`.
 *
 * Callers give a width and get the correct height. Passing both is how a logo ends up subtly
 * stretched on one screen and not another, so this deliberately does not accept a height.
 *
 * The mark is black-on-transparent, so it sits correctly on both white surfaces and the yellow
 * header without a second asset.
 */
export function Logo({ width = 200, showBadge = false }: LogoProps): ReactElement {
  const mark = (
    <SvgXml
      xml={LOGO_SVG}
      width={width}
      height={width * ASPECT}
      accessibilityRole="image"
      accessibilityLabel="DriverZone"
    />
  );

  if (!showBadge) return mark;

  return (
    <View style={styles.row}>
      {mark}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>DRIVER</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    marginLeft: space.sm,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: fontFamily.bold,
    fontWeight: '700',
    color: colors.brandOnFg,
    letterSpacing: 1.2,
  },
});
