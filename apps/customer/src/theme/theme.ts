/**
 * The customer app's palette.
 *
 * Deliberately NOT `@driverzone/design-system`'s `colors`. That accent is `#c0ff72`, a near-white
 * lime chosen for the admin panel and pinned by `theme.contrast.test.ts` — the customer brand in
 * the approved screens is a saturated yellow with black ink. Repointing the shared token would
 * fail those guards and restyle the panel, so the two live apart until somebody decides the whole
 * product moves to yellow.
 *
 * What IS shared: `space`, `radius` and `fontSize`, imported below. Scales are the part worth
 * keeping identical across apps; hues are the part that legitimately differ.
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
  /** The faint skyline and cloud shapes behind the login card. Decorative only. */
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

  // Yellow on black needs to be brighter than the surface yellow to stay legible at 16sp.
  onFg: '#FFFFFF',
  brandOnFg: '#F5E500',

  border: '#E4E4DC',
  borderStrong: '#C9C9BF',
  /** The focused OTP cell. */
  focus: '#E0C000',

  success: '#1A7F37',
  danger: '#CF222E',
  link: '#1F5FD0',
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
 * Every entry carries BOTH `fontWeight` and the matching `fontFamily` from `./fonts`. The two
 * are not redundant: `fontFamily` is what actually selects Plus Jakarta Sans's bold/semibold/
 * regular face — see the note in `fonts.ts` for why Android needs the exact family, not the
 * weight number — while `fontWeight` stays for iOS's synthesis and so a screen overriding just
 * the weight (without knowing to touch `fontFamily` too) fails loudly as mismatched text rather
 * than silently rendering the wrong face.
 */
export const text = {
  display: { fontSize: 30, lineHeight: 38, fontWeight: '700', fontFamily: fontFamily.bold },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '700', fontFamily: fontFamily.bold },
  heading: { fontSize: 19, lineHeight: 26, fontWeight: '700', fontFamily: fontFamily.bold },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', fontFamily: fontFamily.regular },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', fontFamily: fontFamily.semibold },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400', fontFamily: fontFamily.regular },
} as const;
