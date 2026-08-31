/**
 * Plus Jakarta Sans — the app's typeface, replacing the OS default (Roboto on Android, San
 * Francisco on iOS).
 *
 * Bundled locally via `@expo-google-fonts/plus-jakarta-sans`: the `.ttf` files ship as assets
 * inside the package and Metro packages them into the app binary, so there is no network fetch
 * and no flash-of-system-font — the splash screen simply stays up the extra instant it takes
 * `useFonts` to resolve (see `app/_layout.tsx`).
 *
 * ONE FAMILY NAME PER WEIGHT, not one family with several weight faces. Each entry below is its
 * own distinct native font, registered under its own exact string — `fontFamily:
 * 'PlusJakartaSans_700Bold'` IS the bold face, full stop. That sidesteps the classic
 * Android-ignores-fontWeight-on-a-custom-font problem: that bug happens when several weights
 * share ONE family name and the OS has to disambiguate by `fontWeight`; it cannot arise here
 * because there is nothing to disambiguate.
 *
 * `fontWeight` is still set alongside `fontFamily` at every call site (see `theme.ts`'s `text`
 * scale) — not because it does anything on Android, but because iOS's bold/italic style
 * synthesis reads it, and because a stray inline `fontWeight` override elsewhere in a component
 * should never silently win against an unrelated font file.
 */
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

/** Passed to `useFonts()` in the root layout. The KEYS here are the `fontFamily` strings below. */
export const FONTS_TO_LOAD = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} as const;

/**
 * Every weight the app actually uses, named for what it's FOR rather than its number — a call
 * site asking for `fontFamily.bold` reads correctly without the reader translating a numeral.
 * Extend this object, and `FONTS_TO_LOAD` above, together if a screen ever needs a weight that
 * is not here yet.
 */
export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;
