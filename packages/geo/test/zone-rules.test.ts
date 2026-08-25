import { describe, expect, it } from 'vitest';
import {
  checkMaximumArea,
  checkOverlap,
  checkWithinParent,
  clipToParent,
  normalizeWinding,
  validateZone,
  zoneStats,
} from '../src/zone-rules.js';
import {
  BOWTIE,
  CENTRAL_PICKUP,
  EASTERN_PICKUP,
  NORTHERN_OVERLAPPER,
  OUTSIDE_PICKUP,
  OVERLAPPING_PICKUP,
  SILIGURI_CITY,
  STRADDLING_PICKUP,
  TINY,
} from './fixtures.js';

const errors = (vs: { severity: string }[]) => vs.filter((v) => v.severity === 'ERROR');

describe('Z-3 — polygon validity', () => {
  it('accepts a well-formed polygon', () => {
    expect(errors(validateZone({ geom: CENTRAL_PICKUP }))).toHaveLength(0);
  });

  it('rejects a self-intersecting bowtie', () => {
    const vs = validateZone({ geom: BOWTIE });
    expect(vs.some((v) => v.rule === 'Z-3')).toBe(true);
  });

  it('stops after Z-3 rather than reporting nonsense derived from a broken polygon', () => {
    const vs = validateZone({ geom: BOWTIE, parentGeom: SILIGURI_CITY });
    expect(vs.every((v) => v.rule === 'Z-3')).toBe(true);
  });

  it('rejects an unclosed ring', () => {
    const open = {
      type: 'Polygon' as const,
      coordinates: [[[88.4, 26.7], [88.45, 26.7], [88.45, 26.74], [88.4, 26.74]]],
    };
    expect(validateZone({ geom: open }).some((v) => v.rule === 'Z-3')).toBe(true);
  });
});

describe('Z-MIN-AREA', () => {
  it('rejects a zone below one hectare', () => {
    expect(validateZone({ geom: TINY }).some((v) => v.rule === 'Z-MIN-AREA')).toBe(true);
  });
});

describe('Z-1 — pickup zone inside its city', () => {
  it('accepts a pickup zone well inside the city', () => {
    expect(checkWithinParent(CENTRAL_PICKUP, SILIGURI_CITY)).toHaveLength(0);
  });

  it('rejects one straddling the boundary', () => {
    const vs = checkWithinParent(STRADDLING_PICKUP, SILIGURI_CITY);
    expect(vs).toHaveLength(1);
    expect(vs[0]?.rule).toBe('Z-1');
  });

  it('reports the spilling area so the editor can paint it', () => {
    const vs = checkWithinParent(STRADDLING_PICKUP, SILIGURI_CITY);
    expect(vs[0]?.message).toMatch(/km² outside/);
    expect(vs[0]?.offendingGeometry?.type).toBe('Polygon');
  });

  it('rejects one entirely outside the city', () => {
    expect(checkWithinParent(OUTSIDE_PICKUP, SILIGURI_CITY)).toHaveLength(1);
  });

  it('clips a straddling polygon back inside its city', () => {
    const clipped = clipToParent(STRADDLING_PICKUP, SILIGURI_CITY);
    expect(clipped).not.toBeNull();
    expect(checkWithinParent(clipped!, SILIGURI_CITY)).toHaveLength(0);
  });

  it('returns null when nothing survives the clip', () => {
    expect(clipToParent(OUTSIDE_PICKUP, SILIGURI_CITY)).toBeNull();
  });
});

describe('Z-2 — same-type zones must not overlap', () => {
  const central = [{ id: 'c', name: 'Siliguri Central', geom: CENTRAL_PICKUP }];

  it('rejects a genuine overlap and names the conflicting zone', () => {
    const vs = checkOverlap(OVERLAPPING_PICKUP, central);
    expect(vs).toHaveLength(1);
    expect(vs[0]?.message).toMatch(/Siliguri Central/);
  });

  it('allows neighbours that share a border exactly', () => {
    expect(checkOverlap(EASTERN_PICKUP, central)).toHaveLength(0);
  });

  it('allows a zone with no siblings', () => {
    expect(checkOverlap(CENTRAL_PICKUP, [])).toHaveLength(0);
  });

  it('catches a sibling fully containing the candidate', () => {
    const city = [{ id: 'x', name: 'Whole City', geom: SILIGURI_CITY }];
    expect(checkOverlap(CENTRAL_PICKUP, city)).toHaveLength(1);
  });
});

describe('validateZone — the full gate', () => {
  it('passes a correctly drawn pickup zone', () => {
    const vs = validateZone({
      geom: CENTRAL_PICKUP,
      parentGeom: SILIGURI_CITY,
      siblings: [{ id: 'e', name: 'Eastern', geom: EASTERN_PICKUP }],
    });
    expect(errors(vs)).toHaveLength(0);
  });

  it('reports Z-1 and Z-2 together so the admin fixes both in one pass', () => {
    const vs = validateZone({
      geom: STRADDLING_PICKUP,
      parentGeom: SILIGURI_CITY,
      siblings: [{ id: 'o', name: 'Overlapper', geom: NORTHERN_OVERLAPPER }],
    });
    expect(vs.map((v) => v.rule).sort()).toEqual(['Z-1', 'Z-2']);
  });
});

describe('zoneStats — informational only, not an invariant', () => {
  it('reports a positive area and the ring vertex count, closing point included', () => {
    const stats = zoneStats(CENTRAL_PICKUP);
    expect(stats.areaKm2).toBeGreaterThan(0);
    // 4 distinct corners plus the closing repeat of the first point.
    expect(stats.vertexCount).toBe(5);
  });
});

describe('Z-MAX-AREA — implausibly large for an operational zone', () => {
  it('accepts an ordinary pickup-zone-sized polygon', () => {
    expect(checkMaximumArea(CENTRAL_PICKUP)).toHaveLength(0);
  });

  it('rejects a polygon covering more than the operational ceiling', () => {
    // A ~10° square near the equator is on the order of 1,000,000 km² — well past the
    // 100,000 km² ceiling, without needing anywhere near hemisphere scale.
    const huge = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [70, 10],
          [80, 10],
          [80, 20],
          [70, 20],
          [70, 10],
        ],
      ],
    };
    const vs = checkMaximumArea(huge);
    expect(vs).toHaveLength(1);
    expect(vs[0]?.rule).toBe('Z-MAX-AREA');
  });
});

describe('normalizeWinding — the ring-winding trap', () => {
  it('reverses a clockwise exterior ring to counter-clockwise', () => {
    // CENTRAL_PICKUP is drawn counter-clockwise; reverse its ring to force clockwise input.
    const clockwise = {
      type: 'Polygon' as const,
      coordinates: [[...CENTRAL_PICKUP.coordinates[0]!].reverse()],
    };
    const normalized = normalizeWinding(clockwise);
    expect(normalized.coordinates).toEqual(CENTRAL_PICKUP.coordinates);
  });

  it('leaves an already counter-clockwise ring unchanged', () => {
    expect(normalizeWinding(CENTRAL_PICKUP).coordinates).toEqual(CENTRAL_PICKUP.coordinates);
  });

  it('does not throw on a ring with fewer than four points — hands it back for checkValidity to reject', () => {
    // @turf/helpers' polygon() constructor throws on this; normalizeWinding must not propagate
    // that, since it runs before validateZone/checkValidity gets a chance to report Z-3 nicely.
    const tooShort = { type: 'Polygon' as const, coordinates: [[[88.4, 26.7], [88.5, 26.7], [88.4, 26.7]]] };
    expect(() => normalizeWinding(tooShort)).not.toThrow();
    expect(normalizeWinding(tooShort)).toEqual(tooShort);
  });

  it('does not throw on an unclosed ring — hands it back for checkValidity to reject', () => {
    const unclosed = {
      type: 'Polygon' as const,
      coordinates: [[[88.4, 26.7], [88.5, 26.7], [88.5, 26.75], [88.4, 26.75]]],
    };
    expect(() => normalizeWinding(unclosed)).not.toThrow();
  });

  it('validateZone still reports Z-3 for these after normalizeWinding passes them through', () => {
    const unclosed = {
      type: 'Polygon' as const,
      coordinates: [[[88.4, 26.7], [88.5, 26.7], [88.5, 26.75], [88.4, 26.75]]],
    };
    const vs = validateZone({ geom: normalizeWinding(unclosed) });
    expect(vs.some((v) => v.rule === 'Z-3' && v.severity === 'ERROR')).toBe(true);
  });
});
