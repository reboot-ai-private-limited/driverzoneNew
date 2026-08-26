/**
 * `theme.css` must agree with `tokens.ts`.
 *
 * Tailwind v4's @theme is CSS and cannot import TypeScript, so the palette necessarily exists
 * in two files. Generating one from the other would give a package that deliberately ships
 * source a build step, and a stale generated file is worse than no generation at all — so this
 * asserts parity instead. Same idea as `identity.typecheck.ts` and `zones.typecheck.ts` on the
 * API, which compare Zod schemas against the contract types rather than deriving one from
 * the other.
 *
 * If this fails, one of the two files was edited and the other was not. Fix the file, not
 * the test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { breakpoint, colors, fontSize, radius, space } from './tokens';

const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

/** Every `--name: value;` inside the @theme block. */
function themeVars(): Map<string, string> {
  const block = css.slice(css.indexOf('@theme'));
  const out = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gim)) {
    // The regex cannot see comment boundaries; a declaration inside /* */ would be a false
    // entry. Nothing in theme.css does that today, and this keeps the parser honest if
    // someone comments a token out rather than deleting it.
    out.set(name!.trim(), value!.trim());
  }
  return out;
}

const vars = themeVars();

/** Tailwind's own default, used when theme.css does not restate it. */
const DEFAULT_SPACING_BASE = '0.25rem';

/** tokens.ts key → the CSS custom property that must carry the same value. */
const COLOR_MAP: Record<keyof typeof colors, string> = {
  bg: '--color-surface',
  bgSunken: '--color-surface-sunken',
  bgMuted: '--color-surface-muted',
  fg: '--color-text',
  muted: '--color-text-subtle',
  accent: '--color-accent',
  accentHover: '--color-accent-hover',
  accentInk: '--color-accent-ink',
  interactive: '--color-interactive',
  interactiveHover: '--color-interactive-hover',
  border: '--color-border',
  borderStrong: '--color-border-strong',
  success: '--color-success',
  warning: '--color-warning',
  danger: '--color-danger',
  zoneCity: '--color-zone-city',
  zonePickupFree: '--color-zone-pickup-free',
  zonePickupPaid: '--color-zone-pickup-paid',
  zoneHill: '--color-zone-hill',
  zoneViolation: '--color-zone-violation',
};

describe('theme.css mirrors tokens.ts', () => {
  it.each(Object.entries(COLOR_MAP))('colors.%s → %s', (key, cssVar) => {
    const expected = colors[key as keyof typeof colors].toLowerCase();
    expect(vars.get(cssVar)?.toLowerCase(), `${cssVar} missing from theme.css`).toBe(expected);
  });

  /**
   * Spacing has no named CSS variables — the web uses Tailwind's numeric scale off the
   * `--spacing` base, and `tokens.ts` carries the same five values for React Native. What keeps
   * them one scale is that every token is an exact multiple of that base, so the `md` token
   * (16) and `p-4` (4 x 0.25rem = 16px) are provably the same number.
   */
  it.each(Object.entries(space))(
    'space.%s is a whole multiple of the --spacing base',
    (_key, px) => {
      const base = vars.get('--spacing') ?? DEFAULT_SPACING_BASE;
      const basePx = base.endsWith('rem') ? Number.parseFloat(base) * 16 : Number.parseFloat(base);
      expect(px % basePx, `${px}px is not a multiple of ${basePx}px`).toBe(0);
    },
  );

  it.each(Object.entries(radius))('radius.%s → --radius-%s', (key, px) => {
    expect(vars.get(`--radius-${key}`)).toBe(`${px}px`);
  });

  it.each(Object.entries(fontSize))('fontSize.%s → --text-%s', (key, px) => {
    expect(vars.get(`--text-${key}`)).toBe(`${px}px`);
  });

  it.each(Object.entries(breakpoint))('breakpoint.%s → --breakpoint-%s', (key, px) => {
    expect(vars.get(`--breakpoint-${key}`)).toBe(`${px}px`);
  });

  /**
   * THE GUARD FOR A BUG THAT ALREADY HAPPENED.
   *
   * `max-w-*` reads Tailwind's `--container-*` scale and falls back to `--spacing-*` when a
   * container key is missing. So declaring `--spacing-sm` here silently redefined `max-w-sm`
   * from 24rem to 8px, and every max-width in the app collapsed to a vertical line. Nothing
   * errored: types, lint, tests and the production build all passed.
   *
   * A comment in theme.css is not enough for a failure that quiet.
   */
  it("declares no --spacing-* key that would shadow Tailwind's --container-* scale", () => {
    const reserved = new Set([
      '3xs',
      '2xs',
      'xs',
      'sm',
      'md',
      'lg',
      'xl',
      '2xl',
      '3xl',
      '4xl',
      '5xl',
      '6xl',
      '7xl',
    ]);
    const shadowing = [...vars.keys()]
      .filter((name) => name.startsWith('--spacing-'))
      .filter((name) => reserved.has(name.slice('--spacing-'.length)));

    expect(
      shadowing,
      'these names belong to --container-*; use a numeric utility or a different name',
    ).toEqual([]);
  });

  it('declares no colour that tokens.ts does not know about', () => {
    const known = new Set(Object.values(COLOR_MAP));
    const declared = [...vars.keys()].filter((n) => n.startsWith('--color-'));
    expect(declared.filter((n) => !known.has(n))).toEqual([]);
  });
});
