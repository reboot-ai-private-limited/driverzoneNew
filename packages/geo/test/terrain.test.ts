import { describe, expect, it } from 'vitest';
import { classifyTerrain, hillMetresOnRoute } from '../src/terrain.js';
import { DARJEELING_HILLS, ROUTE_GRAZING_HILLS, ROUTE_ON_PLAINS, ROUTE_TO_HILLS } from './fixtures.js';

const THRESHOLD = 5000;

describe('terrain classification', () => {
  it('reports zero hill metres with no hill zones configured', () => {
    expect(hillMetresOnRoute(ROUTE_TO_HILLS, [])).toBe(0);
  });

  it('classifies a plains route as PLAIN', () => {
    const r = classifyTerrain(ROUTE_ON_PLAINS, [DARJEELING_HILLS], THRESHOLD);
    expect(r.terrain).toBe('PLAIN');
    expect(r.hillMetres).toBe(0);
  });

  it('classifies a long climb as HILL', () => {
    const r = classifyTerrain(ROUTE_TO_HILLS, [DARJEELING_HILLS], THRESHOLD);
    expect(r.terrain).toBe('HILL');
    expect(r.hillMetres).toBeGreaterThan(THRESHOLD);
  });

  it('does not call a brief corner-clip a hill trip', () => {
    const r = classifyTerrain(ROUTE_GRAZING_HILLS, [DARJEELING_HILLS], THRESHOLD);
    expect(r.hillMetres).toBeGreaterThan(0);
    expect(r.hillMetres).toBeLessThan(THRESHOLD);
    expect(r.terrain).toBe('PLAIN');
  });

  it('honours the threshold — the same route flips when ops lowers it', () => {
    expect(classifyTerrain(ROUTE_GRAZING_HILLS, [DARJEELING_HILLS], 100).terrain).toBe('HILL');
  });
});
