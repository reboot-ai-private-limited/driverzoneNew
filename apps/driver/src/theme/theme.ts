/**
 * The driver app's palette.
 *
 * The SAME brand yellow and ink as `apps/customer` — one product, one brand, and a driver who
 * also uses the customer app should not think they installed something from a different company.
 * `space`, `radius` and `fontSize` come from `@driverzone/mobile-ui`, shared with the customer
 * app; scales are the part worth keeping identical, and here even the hues match.
 *
 * The one addition the customer app has no use for is the DUTY palette below: on/off duty is the
 * driver app's single most important piece of state, and it needs a colour of its own that is
 * neither the brand nor an error.
 */
import { fontSize, radius, space } from '@driverzone/mobile-ui';
import { fontFamily } from './fonts';

export { fontSize, radius, space, fontFamily };

export const colors = {
  // Brand. Yellow is a SURFACE — its contrast against white is ~1.1:1, so nothing readable is
  // ever painted in it. Ink on yellow is always `fg`.
  brand: '#F2F200',
  brandBright: '#FAFA1E',
  brandSoft: '#FEFEE8',
  brandWash: '#FBFBC4',

  // Surfaces
  bg: '#FFFFFF',
  bgSunken: '#F7F7F2',
  card: '#FFFFFF',

  // Ink. `fg` is the button fill as well as the body colour — the design pairs black and yellow
  // directly, so one token does both jobs.
  fg: '#1A1A1A',
  muted: '#6B6B66',
  faint: '#9A9A94',

  onFg: '#FFFFFF',
  brandOnFg: '#F5E500',

  border: '#E4E4DC',
  borderStrong: '#C9C9BF',
  focus: '#E0C000',

  success: '#1A7F37',
  warning: '#9A6700',
  danger: '#CF222E',
  link: '#1F5FD0',

  /**
   * Duty state. Green for online is the one colour convention every driver app shares, and
   * fighting it would cost comprehension for nothing. `dutyOffBg` is a neutral rather than a red:
   * being off duty is a normal choice, not a fault.
   */
  dutyOn: '#1A7F37',
  dutyOnBg: '#E8F5EC',
  dutyOff: '#6B6B66',
  dutyOffBg: '#F1F1EC',
} as const;

/**
 * Shadows are per-platform in React Native: iOS reads the four `shadow*` props, Android reads
 * `elevation` and ignores the rest. Both are set so a card looks the same on either.
 */
export const shadow = {
  card: {
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  soft: {
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

/**
 * Line heights are absolute, not multipliers — RN does not accept a unitless value.
 *
 * Every entry carries BOTH `fontWeight` and the matching `fontFamily`. The two are not
 * redundant: `fontFamily` selects Plus Jakarta Sans's actual face (see `fonts.ts`), while
 * `fontWeight` stays for iOS's synthesis and so a screen overriding only the weight fails
 * loudly as mismatched text rather than silently rendering the wrong face.
 */
export const text = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: '700', fontFamily: fontFamily.bold },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '700', fontFamily: fontFamily.bold },
  heading: { fontSize: 19, lineHeight: 26, fontWeight: '700', fontFamily: fontFamily.bold },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', fontFamily: fontFamily.regular },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', fontFamily: fontFamily.semibold },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400', fontFamily: fontFamily.regular },
} as const;
