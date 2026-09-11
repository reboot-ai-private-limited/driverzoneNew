import { describe, expect, it } from 'vitest';
import type { OutstationPackageDto } from '@driverzone/contracts';
import {
  buildCoverage,
  coverageLostWithout,
  findOverlap,
  formatBand,
  ladderFor,
  splitAt,
  stripCells,
  validateBand,
  validateSplit,
  type LadderBand,
} from './band';

function band(id: string, minKm: number, maxKm: number): LadderBand {
  return { id, name: id, minKm, maxKm };
}

function pkg(over: Partial<OutstationPackageDto> & { id: string }): OutstationPackageDto {
  return {
    name: over.id,
    terrain: 'PLAIN',
    min_km: 0,
    max_km: 70,
    one_way_fare_paise: 180000,
    round_trip_fare_paise: 320000,
    one_way_driver_amount_paise: 120000,
    round_trip_driver_amount_paise: 200000,
    variants: [],
    is_active: true,
    ...over,
  };
}

describe('buildCoverage', () => {
  it('tiles adjacent half-open bands with no gap between them', () => {
    const segments = buildCoverage([band('a', 0, 70), band('b', 70, 100)]);

    expect(segments.slice(0, 2)).toEqual([
      { from: 0, to: 70, kind: 'covered', packageId: 'a', name: 'a' },
      { from: 70, to: 100, kind: 'covered', packageId: 'b', name: 'b' },
    ]);
  });

  it('reports the hole between two bands that fail to meet', () => {
    const segments = buildCoverage([band('a', 0, 70), band('b', 100, 150)]);

    expect(segments.filter((s) => s.kind === 'gap')).toEqual([
      { from: 70, to: 100, kind: 'gap' },
      { from: 150, to: null, kind: 'gap' },
    ]);
  });

  it('reports a leading gap when nothing covers the shortest trips', () => {
    const [first] = buildCoverage([band('a', 20, 70)]);

    expect(first).toEqual({ from: 0, to: 20, kind: 'gap' });
  });

  it('always ends in an open tail gap, because the furthest band is never the last trip', () => {
    const segments = buildCoverage([band('a', 0, 70), band('b', 70, 150)]);

    expect(segments.at(-1)).toEqual({ from: 150, to: null, kind: 'gap' });
  });

  it('renders nothing configured as one gap covering everything', () => {
    expect(buildCoverage([])).toEqual([{ from: 0, to: null, kind: 'gap' }]);
  });

  it('renders an overlap rather than hiding it — the server forbids it, the admin must see it', () => {
    const segments = buildCoverage([band('a', 0, 70), band('b', 50, 100)]);

    expect(segments[1]).toMatchObject({ packageId: 'b', overlapsPrevious: true });
    expect(segments.filter((s) => s.kind === 'gap')).toEqual([
      { from: 100, to: null, kind: 'gap' },
    ]);
  });

  it('is computed per terrain — HILL and PLAIN ladders never see each other', () => {
    const packages = [
      pkg({ id: 'plain', terrain: 'PLAIN', min_km: 0, max_km: 70 }),
      pkg({ id: 'hill', terrain: 'HILL', min_km: 0, max_km: 70 }),
    ];

    expect(ladderFor(packages, 'HILL')).toEqual([
      { id: 'hill', name: 'hill', minKm: 0, maxKm: 70 },
    ]);
    expect(ladderFor(packages, 'PLAIN')).toHaveLength(1);
  });

  it('leaves an inactive band out of the ladder, matching the server overlap filter', () => {
    const packages = [pkg({ id: 'off', is_active: false })];

    expect(ladderFor(packages, 'PLAIN')).toEqual([]);
  });
});

describe('validateBand', () => {
  it('accepts a normal band', () => {
    expect(validateBand(70, 100)).toBeNull();
  });

  it('rejects a zero-width band', () => {
    expect(validateBand(100, 100)).toMatch(/greater than/);
  });

  it('rejects an inverted band', () => {
    expect(validateBand(100, 70)).toMatch(/greater than/);
  });

  it('rejects a negative lower bound', () => {
    expect(validateBand(-1, 70)).toMatch(/negative/);
  });

  it('rejects fractional km, because the API takes integers', () => {
    expect(validateBand(0, 70.5)).toMatch(/whole km/);
  });
});

describe('findOverlap', () => {
  const existing = [
    pkg({ id: 'plain-a', terrain: 'PLAIN', min_km: 0, max_km: 70 }),
    pkg({ id: 'hill-a', terrain: 'HILL', min_km: 0, max_km: 70 }),
  ];

  it('flags a band that overlaps another of the SAME terrain', () => {
    expect(findOverlap({ terrain: 'PLAIN', minKm: 50, maxKm: 80 }, existing)?.id).toBe('plain-a');
  });

  it('permits the identical band on the OTHER terrain — two independent ladders', () => {
    expect(findOverlap({ terrain: 'HILL', minKm: 0, maxKm: 70 }, [existing[0]!])).toBeNull();
  });

  it('permits bands that merely touch, because the range is half-open', () => {
    expect(findOverlap({ terrain: 'PLAIN', minKm: 70, maxKm: 100 }, existing)).toBeNull();
  });

  it('does not flag a band against itself when editing', () => {
    expect(
      findOverlap({ terrain: 'PLAIN', minKm: 0, maxKm: 70, id: 'plain-a' }, existing),
    ).toBeNull();
  });

  it('ignores an inactive band, matching the server query', () => {
    const inactive = [pkg({ id: 'off', min_km: 0, max_km: 70, is_active: false })];

    expect(findOverlap({ terrain: 'PLAIN', minKm: 10, maxKm: 20 }, inactive)).toBeNull();
  });
});

describe('coverageLostWithout', () => {
  it('names the distances that go dark when a middle band is removed', () => {
    const bands = [band('a', 0, 70), band('b', 70, 100), band('c', 100, 150)];

    expect(coverageLostWithout(bands, 'b')).toEqual([{ from: 70, to: 100, kind: 'gap' }]);
  });

  it('reports the widened tail when the furthest band is removed', () => {
    const bands = [band('a', 0, 70), band('b', 70, 100)];

    expect(coverageLostWithout(bands, 'b')).toEqual([{ from: 70, to: null, kind: 'gap' }]);
  });

  it('reports nothing when a neighbour already covers the same range', () => {
    const bands = [band('a', 0, 100), band('b', 0, 100)];

    expect(coverageLostWithout(bands, 'b')).toEqual([]);
  });
});

describe('formatBand', () => {
  it('reads as a range', () => {
    expect(formatBand(70, 100)).toBe('70–100 km');
  });

  it('reads as open-ended for the tail', () => {
    expect(formatBand(150, null)).toBe('150 km and above');
  });
});

describe('splitAt', () => {
  it('produces two half-open bands that meet exactly, with no gap and no overlap', () => {
    const [left, right] = splitAt({ minKm: 0, maxKm: 150 }, 70);

    expect(left).toEqual({ minKm: 0, maxKm: 70 });
    expect(right).toEqual({ minKm: 70, maxKm: 150 });
    // The halves tile: rebuilding coverage over both leaves only the open tail.
    const segments = buildCoverage([
      { id: 'l', name: 'l', ...left },
      { id: 'r', name: 'r', ...right },
    ]);
    expect(segments.filter((s) => s.kind === 'gap')).toEqual([
      { from: 150, to: null, kind: 'gap' },
    ]);
  });

  it('covers exactly what the original band covered', () => {
    const original = { minKm: 20, maxKm: 90 };
    const [left, right] = splitAt(original, 50);

    expect(left.minKm).toBe(original.minKm);
    expect(right.maxKm).toBe(original.maxKm);
  });
});

describe('validateSplit', () => {
  const band = { minKm: 0, maxKm: 150 };

  it('accepts a point strictly inside the band', () => {
    expect(validateSplit(band, 70)).toBeNull();
  });

  it('refuses either endpoint, which would make a zero-width half', () => {
    expect(validateSplit(band, 0)).toMatch(/between/);
    expect(validateSplit(band, 150)).toMatch(/between/);
  });

  it('refuses a point outside the band entirely', () => {
    expect(validateSplit(band, 200)).toMatch(/between/);
  });

  it('refuses a fractional point, because the API takes whole km', () => {
    expect(validateSplit(band, 70.5)).toMatch(/whole number/);
  });
});

describe('stripCells', () => {
  it('sizes bounded cells by their actual km, which is all the strip knows that the table does not', () => {
    const cells = stripCells(buildCoverage([band('a', 0, 70), band('b', 70, 105)]));

    expect(cells.at(0)?.weight).toBe(70);
    expect(cells.at(1)?.weight).toBe(35);
  });

  it('floors a sliver rather than letting it round away to nothing', () => {
    // 2 km beside 298 km is 0.67% of the bar — sub-pixel at any realistic width.
    const cells = stripCells(buildCoverage([band('a', 0, 2), band('b', 2, 300)]));

    expect(cells.at(0)?.weight).toBeGreaterThan(2);
    expect(cells.at(0)?.weight).toBe(300 * 0.06);
  });

  it('gives the open tail a fixed share, having no upper bound to be proportional to', () => {
    const cells = stripCells(buildCoverage([band('a', 0, 200)]));
    const tail = cells.at(-1);

    expect(tail?.segment).toEqual({ from: 200, to: null, kind: 'gap' });
    expect(tail?.weight).toBe(50);
  });

  it('makes the tail the whole bar when nothing is priced at all', () => {
    const cells = stripCells(buildCoverage([]));

    expect(cells).toEqual([{ segment: { from: 0, to: null, kind: 'gap' }, weight: 1 }]);
  });

  it('keeps a hole between two bands as its own cell, at its own width', () => {
    const cells = stripCells(buildCoverage([band('a', 0, 70), band('b', 100, 150)]));

    expect(cells.map((cell) => [cell.segment.kind, cell.weight])).toEqual([
      ['covered', 70],
      ['gap', 30],
      ['covered', 50],
      ['gap', 150 * 0.25],
    ]);
  });
});
