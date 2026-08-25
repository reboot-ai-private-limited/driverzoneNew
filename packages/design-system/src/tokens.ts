/**
 * Design tokens — the ONE file shared between web and native.
 *
 * Plain values, no imports. That is what lets @driverzone/mobile-ui consume it without
 * pulling a single web dependency into a React Native bundle. Components cannot be shared
 * across the two (a `div` is not a `View`); the values behind them can and should be.
 *
 * `src/theme.css` mirrors everything here for Tailwind. The two are held together by
 * `tokens.drift.test.ts` rather than by codegen — see docs/engineering/shared-packages.md.
 */

/**
 * Raw palette. A COMPONENT SHOULD NOT USE THESE DIRECTLY — it uses the semantic names in
 * `theme.css` (`--color-text`, `--color-accent-ink`, …), which is the layer where the contrast
 * rules are checked. These exist so `theme.css` and React Native have one source for the values.
 *
 * The accent is a near-white lime: 1.18:1 against white, 17.79:1 against black. It is a
 * SURFACE, never an INK. Anything that needs to be a coloured ink — a link, a focus ring, a
 * selected state — uses `interactive`. See docs/engineering/design-language.md §Color.
 */
export const colors = {
  // Surfaces
  bg: '#ffffff',
  bgSunken: '#f7f8f5',
  bgMuted: '#edefea',

  // Ink
  fg: '#1c1b1f',
  muted: '#5c635a',

  // Brand. Fill only — see the note above.
  accent: '#c0ff72',
  accentHover: '#aef255',
  accentInk: '#1c1b1f',

  // The coloured ink. 7.08:1 on bg, 6.65:1 on bgSunken, 6.00:1 on accent.
  interactive: '#3f6212',
  interactiveHover: '#365314',

  // Hairlines are decorative; control boundaries carry meaning and need 3:1 (WCAG 1.4.11).
  border: '#d8dcd5',
  borderStrong: '#8a9281',

  // Status
  success: '#1a7f37',
  warning: '#9a6700',
  danger: '#cf222e',

  /** Zone-editor fills, matching docs/LLD/admin-panel.md. Map polygons, not UI colour. */
  zoneCity: '#0b6bcb',
  zonePickupFree: '#1a7f37',
  zonePickupPaid: '#9a6700',
  zoneHill: '#8250df',
  zoneViolation: '#cf222e',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 40 } as const;
export const radius = { sm: 4, md: 8, lg: 16, pill: 999 } as const;
export const fontSize = { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 } as const;

/**
 * The panel targets >= 1024px (`lg`). The wide end matters as a CAP, not a target: a table
 * stretched across 3440px puts a row's first and last cell too far apart to read as one row,
 * so the content region takes a max width there.
 */
export const breakpoint = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
  '3xl': 1920,
  '4xl': 2560,
  '5xl': 3440,
} as const;

/**
 * Every foreground/background pair the design language declares, with the minimum ratio it must
 * meet. `theme.contrast.test.ts` walks this list.
 *
 * It lives here rather than in the test file so that adding a colour pairing to the design
 * language is an edit to the design system, not to a test someone can forget exists.
 */
export const contrastPairs = [
  { fg: colors.fg, bg: colors.bg, min: 4.5, name: 'text on surface' },
  { fg: colors.fg, bg: colors.bgSunken, min: 4.5, name: 'text on sunken' },
  { fg: colors.fg, bg: colors.bgMuted, min: 4.5, name: 'text on muted' },
  { fg: colors.muted, bg: colors.bg, min: 4.5, name: 'subtle text on surface' },
  { fg: colors.muted, bg: colors.bgSunken, min: 4.5, name: 'subtle text on sunken' },
  { fg: colors.accentInk, bg: colors.accent, min: 4.5, name: 'ink on accent' },
  { fg: colors.accentInk, bg: colors.accentHover, min: 4.5, name: 'ink on accent hover' },
  { fg: colors.interactive, bg: colors.bg, min: 4.5, name: 'interactive on surface' },
  { fg: colors.interactive, bg: colors.bgSunken, min: 4.5, name: 'interactive on sunken' },
  { fg: colors.interactive, bg: colors.accent, min: 4.5, name: 'interactive on accent' },
  { fg: colors.interactiveHover, bg: colors.bg, min: 4.5, name: 'interactive hover on surface' },
  { fg: colors.success, bg: colors.bg, min: 4.5, name: 'success on surface' },
  { fg: colors.warning, bg: colors.bg, min: 4.5, name: 'warning on surface' },
  { fg: colors.danger, bg: colors.bg, min: 4.5, name: 'danger on surface' },
  { fg: colors.bg, bg: colors.danger, min: 4.5, name: 'white on danger fill' },
  // Non-text: a control boundary must reach 3:1 against what it sits on (WCAG 1.4.11).
  { fg: colors.borderStrong, bg: colors.bg, min: 3, name: 'control border on surface' },
  { fg: colors.borderStrong, bg: colors.bgSunken, min: 3, name: 'control border on sunken' },
  { fg: colors.interactive, bg: colors.bg, min: 3, name: 'focus ring on surface' },
] as const;
