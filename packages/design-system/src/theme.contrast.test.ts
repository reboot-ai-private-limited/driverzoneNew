/**
 * Every colour pairing the design language declares must be legible.
 *
 * This exists because of one specific hazard. The brand accent `#c0ff72` scores 1.18:1 against
 * white — it is a fill, never an ink — and it looks exactly like a colour someone would reach
 * for as a text colour. This test is the answer that does not depend on anyone having read
 * docs/engineering/design-language.md.
 *
 * The pairings live in `tokens.ts` as `contrastPairs`, so adding one is an edit to the design
 * system rather than to a test file someone can forget exists.
 */
import { describe, expect, it } from 'vitest';
import { colors, contrastPairs } from './tokens';

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x!, y!) + 0.05) / (Math.min(x!, y!) + 0.05);
}

describe('contrast', () => {
  it.each(contrastPairs)('$name meets $min:1', ({ fg, bg, min }) => {
    const ratio = contrastRatio(fg, bg);
    expect(ratio, `${fg} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });

  /**
   * Not a redundant restatement of the rule — it is the rule's tripwire. If someone "fixes"
   * the accent by darkening it so it can be used as text, this fails and points them at the
   * design language rather than letting the brand quietly change colour.
   */
  it('the accent is a surface, not an ink', () => {
    expect(contrastRatio(colors.accent, colors.bg)).toBeLessThan(3);
    expect(contrastRatio(colors.accentInk, colors.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
