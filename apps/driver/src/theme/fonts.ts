/**
 * Plus Jakarta Sans — the same typeface as the customer app, for the same reasons.
 *
 * Bundled locally via `@expo-google-fonts/plus-jakarta-sans`: the `.ttf` files ship as assets
 * inside the package and Metro packages them into the app binary, so there is no network fetch
 * and no flash-of-system-font — the splash screen simply stays up the extra instant it takes
 * `useFonts` to resolve (see `app/_layout.tsx`).
 *
 * ONE FAMILY NAME PER WEIGHT, not one family with several weight faces. Each entry below is its
 * own distinct native font, registered under its own exact string. That sidesteps the classic
 * Android-ignores-fontWeight-on-a-custom-font problem: that bug happens when several weights
 * share ONE family name and the OS has to disambiguate by `fontWeight`; it cannot arise here
 * because there is nothing to disambiguate.
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

export const fontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;
