/**
 * Design tokens — the ONE file shared between web and native.
 *
 * Plain values, no imports. That is what lets @driverzone/mobile-ui consume it without
 * pulling a single web dependency into a React Native bundle. Components cannot be shared
 * across the two (a `div` is not a `View`); the values behind them can and should be.
 */
export const colors = {
  bg: '#ffffff',
  fg: '#101418',
  muted: '#5b6874',
  border: '#e2e6ea',
  brand: '#0b6bcb',
  success: '#1a7f37',
  warning: '#9a6700',
  danger: '#cf222e',
  /** Zone-editor fills, matching docs/LLD/10-admin-panel.md. */
  zoneCity: '#0b6bcb',
  zonePickupFree: '#1a7f37',
  zonePickupPaid: '#9a6700',
  zoneHill: '#8250df',
  zoneViolation: '#cf222e',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
export const radius = { sm: 4, md: 8, lg: 16, pill: 999 } as const;
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 } as const;
