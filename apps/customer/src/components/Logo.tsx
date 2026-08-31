import { LOGO_SVG } from '@driverzone/mobile-ui/logo';
import type { ReactElement } from 'react';
import { SvgXml } from 'react-native-svg';

/** The mark's own aspect ratio, from its viewBox (236 × 126). */
const ASPECT = 126 / 236;

/**
 * The DriverZone logo.
 *
 * Callers give a width and get the correct height — passing both is how a logo ends up subtly
 * stretched on one screen and not another. The artwork itself lives in `logoSvg.ts`; this
 * component only sizes it.
 *
 * The mark is black-on-transparent, so it sits correctly on both the white login card and the
 * yellow header without a second asset.
 */
export function Logo({ width = 240 }: { width?: number }): ReactElement {
  return (
    <SvgXml
      xml={LOGO_SVG}
      width={width}
      height={width * ASPECT}
      accessibilityRole="image"
      accessibilityLabel="DriverZone"
    />
  );
}
