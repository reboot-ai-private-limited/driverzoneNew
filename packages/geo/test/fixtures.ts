import type { LineString, Polygon } from 'geojson';

/** GeoJSON is [lng, lat]. Siliguri sits near 26.71 N, 88.43 E. */
const poly = (ring: [number, number][]): Polygon => ({ type: 'Polygon', coordinates: [ring] });

/** CITY — Siliguri, lng 88.35–88.50, lat 26.65–26.78. */
export const SILIGURI_CITY = poly([
  [88.35, 26.65],
  [88.5, 26.65],
  [88.5, 26.78],
  [88.35, 26.78],
  [88.35, 26.65],
]);

/** PICKUP — well inside the city. */
export const CENTRAL_PICKUP = poly([
  [88.4, 26.7],
  [88.45, 26.7],
  [88.45, 26.74],
  [88.4, 26.74],
  [88.4, 26.7],
]);

/** PICKUP — shares its western edge with CENTRAL exactly. A legitimate neighbour. */
export const EASTERN_PICKUP = poly([
  [88.45, 26.7],
  [88.5, 26.7],
  [88.5, 26.74],
  [88.45, 26.74],
  [88.45, 26.7],
]);

/** PICKUP — genuinely overlaps CENTRAL. */
export const OVERLAPPING_PICKUP = poly([
  [88.43, 26.72],
  [88.48, 26.72],
  [88.48, 26.76],
  [88.43, 26.76],
  [88.43, 26.72],
]);

/** PICKUP — straddles the northern city boundary (city stops at lat 26.78). */
export const STRADDLING_PICKUP = poly([
  [88.4, 26.76],
  [88.45, 26.76],
  [88.45, 26.82],
  [88.4, 26.82],
  [88.4, 26.76],
]);

/** PICKUP — entirely north of the city. */
export const OUTSIDE_PICKUP = poly([
  [88.4, 26.8],
  [88.45, 26.8],
  [88.45, 26.84],
  [88.4, 26.84],
  [88.4, 26.8],
]);

/** Self-intersecting bowtie — what a map editor produces when a corner is dragged across an edge. */
export const BOWTIE = poly([
  [88.4, 26.7],
  [88.45, 26.74],
  [88.45, 26.7],
  [88.4, 26.74],
  [88.4, 26.7],
]);

/** Roughly 30 m square — below the one-hectare minimum. */
export const TINY = poly([
  [88.4, 26.7],
  [88.4003, 26.7],
  [88.4003, 26.7003],
  [88.4, 26.7003],
  [88.4, 26.7],
]);

/** HILL — the Darjeeling belt, north-west of Siliguri. */
export const DARJEELING_HILLS = poly([
  [88.2, 26.9],
  [88.4, 26.9],
  [88.4, 27.1],
  [88.2, 27.1],
  [88.2, 26.9],
]);

const line = (coords: [number, number][]): LineString => ({ type: 'LineString', coordinates: coords });

/** Siliguri → Darjeeling. Climbs a long way into the hill zone. */
export const ROUTE_TO_HILLS = line([
  [88.43, 26.71],
  [88.38, 26.85],
  [88.33, 26.95],
  [88.28, 27.02],
  [88.26, 27.04],
]);

/** Siliguri → a plains town east. Never touches the hill zone. */
export const ROUTE_ON_PLAINS = line([
  [88.43, 26.71],
  [88.47, 26.73],
  [88.52, 26.76],
]);

/** Clips the very south-east corner of the hill zone for a short stretch, then leaves. */
export const ROUTE_GRAZING_HILLS = line([
  [88.42, 26.88],
  [88.398, 26.905],
  [88.42, 26.93],
]);

/**
 * PICKUP — genuinely overlaps STRADDLING_PICKUP (not merely touching its edge).
 * Exists because the obvious pairing, STRADDLING × OVERLAPPING, shares only the lat 26.76
 * line: a border, not an area, which Z-2 is deliberately built to permit.
 */
export const NORTHERN_OVERLAPPER = poly([
  [88.42, 26.77],
  [88.47, 26.77],
  [88.47, 26.81],
  [88.42, 26.81],
  [88.42, 26.77],
]);
