import { describe, expect, it } from 'vitest';
import {
  CoordinateError,
  assertPlausibleCoordinate,
  fromPosition,
  isPlausibleIndianCoordinate,
  toGeoJsonPoint,
  toPosition,
} from '../src/coords.js';

const SILIGURI = { lat: 26.7271, lng: 88.3953 };

describe('coordinate conversion', () => {
  it('puts longitude first, matching GeoJSON and 2dsphere', () => {
    expect(toPosition(SILIGURI)).toEqual([88.3953, 26.7271]);
  });

  it('round-trips through a Position without drift', () => {
    expect(fromPosition(toPosition(SILIGURI))).toEqual(SILIGURI);
  });

  it('builds a GeoJSON Point ready for $geoIntersects', () => {
    expect(toGeoJsonPoint(SILIGURI)).toEqual({ type: 'Point', coordinates: [88.3953, 26.7271] });
  });
});

describe('the lat/lng swap guard', () => {
  it('accepts a real Indian coordinate', () => {
    expect(isPlausibleIndianCoordinate(SILIGURI)).toBe(true);
    expect(() => assertPlausibleCoordinate(SILIGURI)).not.toThrow();
  });

  it('rejects a swapped coordinate rather than resolving it to the wrong place', () => {
    const swapped = { lat: SILIGURI.lng, lng: SILIGURI.lat };
    expect(isPlausibleIndianCoordinate(swapped)).toBe(false);
    expect(() => assertPlausibleCoordinate(swapped)).toThrow(CoordinateError);
  });

  it('names the swap in the message, because that is nearly always the cause', () => {
    expect(() => assertPlausibleCoordinate({ lat: 88.3953, lng: 26.7271 })).toThrow(/swapped/);
  });

  it('rejects an unpopulated 0,0 default', () => {
    expect(() => assertPlausibleCoordinate({ lat: 0, lng: 0 })).toThrow(CoordinateError);
  });

  it('rejects NaN before it reaches a geo query', () => {
    expect(() => assertPlausibleCoordinate({ lat: NaN, lng: 88.4 })).toThrow(/finite/);
  });

  it('labels which coordinate failed', () => {
    expect(() => assertPlausibleCoordinate({ lat: 0, lng: 0 }, 'pickup')).toThrow(/^pickup:/);
  });
});
