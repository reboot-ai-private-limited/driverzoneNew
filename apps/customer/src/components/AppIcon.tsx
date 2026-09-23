import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import type { StyleProp, TextStyle } from 'react-native';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * Feather's set, plus the one glyph this app needs and Feather does not have.
 *
 * **WHY THIS EXISTS AT ALL: Feather has no rupee.** Cash used to be drawn with `dollar-sign`,
 * which is the wrong currency on every screen in an app that prices exclusively in ₹ — a driver
 * reading a cash-collected row saw a dollar beside a rupee amount. Feather ships `dollar-sign`
 * and nothing else in that shape, so the fix cannot be another Feather name; it has to come from
 * a second family.
 *
 * `'rupee'` CANNOT COLLIDE with a real Feather name — Feather has no icon called that — so the
 * union stays unambiguous and a typo still fails the typecheck rather than rendering an empty
 * square. Callers that want the rupee ask for `'rupee'`; everything else is Feather as before.
 *
 * A copy of the driver app's component rather than a shared one, for the reason the driver app's
 * `BottomSheet` gives: `@driverzone/mobile-ui` exports tokens only, and lifting a component into it
 * is a decision about that package's scope rather than something to do in passing.
 */
export type AppIconName = FeatherName | 'rupee';

interface AppIconProps {
  name: AppIconName;
  size: number;
  color: string;
  style?: StyleProp<TextStyle>;
}

/**
 * MaterialCommunityIcons is already a dependency of both tab bars, so the rupee costs no new
 * font: `currency-inr` is the Indian rupee sign, and it sits on the same baseline and optical
 * weight as Feather at the sizes used here.
 */
export function AppIcon({ name, size, color, style }: AppIconProps): ReactElement {
  if (name === 'rupee') {
    return <MaterialCommunityIcons name="currency-inr" size={size} color={color} style={style} />;
  }
  return <Feather name={name} size={size} color={color} style={style} />;
}
