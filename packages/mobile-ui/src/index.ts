/**
 * React Native components shared by apps/customer and apps/driver.
 *
 * Separate from @driverzone/design-system on purpose: RN renders `View`/`Text`, the web
 * renders `div`/Radix, and a package importing both would drag react-dom into a Metro bundle.
 * The two packages share `tokens` and nothing else.
 */
export { colors, fontSize, radius, space } from '@driverzone/design-system/tokens';
