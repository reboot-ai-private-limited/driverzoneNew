import type { ZoneDto } from '@driverzone/contracts';
import { colors } from '@driverzone/design-system';
import type { FeatureCollection, Polygon } from 'geojson';

/**
 * How a zone is painted, and why each type looks the way it does.
 *
 * The colours come from `colors.zone*` in the design tokens rather than the semantic CSS
 * variables, because a Google Maps style takes a literal colour string — there is no stylesheet
 * for an overlay to resolve `var(--color-zone-city)` against. That is also why these five values
 * live in `tokens.ts` at all: they are the one part of the palette that cannot go through
 * `theme.css`.
 *
 * The four fills are chosen to stay distinguishable ON A BASEMAP, which is a different problem
 * from UI contrast (docs/engineering/design-language.md §Color) — a translucent lime over
 * satellite imagery is invisible, so the accent is not among them. That matters more under
 * Google's hybrid view than it did under a plain street map.
 */

export interface ZoneFeatureProperties extends Record<string, unknown> {
  id: string;
  type: ZoneDto['type'];
  name: string;
  /** `'FREE' | 'PAID' | 'NONE'` — flattened, so the style function reads one field, never a null. */
  charge: string;
  selected: boolean;
  /** While one zone is being edited, every other zone drops back so the edit is legible. */
  dimmed: boolean;
}

export function zonesToFeatureCollection(
  zones: ZoneDto[],
  selectedId: string | null,
  dimOthers: boolean,
): FeatureCollection<Polygon, ZoneFeatureProperties> {
  return {
    type: 'FeatureCollection',
    features: zones.map((zone) => ({
      type: 'Feature',
      // `id` at the feature level too: it is what `Data.getFeatureById` keys off, and a
      // collection without one cannot be selectively removed or restyled later.
      id: zone.id,
      geometry: zone.geometry,
      properties: {
        id: zone.id,
        type: zone.type,
        name: zone.name,
        charge: zone.pickup_charge_type ?? 'NONE',
        selected: zone.id === selectedId,
        dimmed: dimOthers && zone.id !== selectedId,
      },
    })),
  };
}

/**
 * A PICKUP zone is coloured by its CHARGE, not by its type.
 *
 * The free/paid split is the only thing about a pickup zone an admin reads off the map, and
 * giving both the same green would hide the one fact that changes what a customer pays.
 */
function fillColour(type: ZoneDto['type'], charge: string): string {
  if (type === 'CITY') return colors.zoneCity;
  if (type === 'PICKUP') return charge === 'PAID' ? colors.zonePickupPaid : colors.zonePickupFree;
  return colors.zoneHill;
}

/**
 * The style function for the saved-zones `Data` layer.
 *
 * Deliberately low fill opacity. Four overlapping translucent polygons over satellite imagery
 * stop being readable well before they stop being visible, and the stroke is what actually
 * carries the boundary.
 *
 * Returned as a plain object rather than a MapLibre paint expression — Google evaluates this per
 * feature in JavaScript, which is both simpler to read and simpler to get right than a nested
 * `["case", ...]` array.
 */
export function zoneFeatureStyle(properties: ZoneFeatureProperties): google.maps.Data.StyleOptions {
  const colour = fillColour(properties.type, properties.charge);

  return {
    fillColor: colour,
    fillOpacity: properties.dimmed ? 0.04 : properties.selected ? 0.3 : 0.15,
    strokeColor: colour,
    strokeWeight: properties.selected ? 3 : 1.5,
    strokeOpacity: properties.dimmed ? 0.25 : 1,
    // The city outline is drawn separately as a dashed polyline (see `CITY_BOUNDARY_STROKE`),
    // so the Data layer must not also stroke it or the dashes sit on top of a solid line.
    ...(properties.type === 'CITY' ? { strokeWeight: 0 } : {}),
    clickable: !properties.dimmed,
    zIndex: properties.selected ? 3 : 1,
  };
}

/**
 * The city boundary is DASHED, always, even when it is not the selection.
 *
 * It is the one polygon that is context rather than content on every other zone's edit — a
 * pickup zone drawn outside it is legal (Z-1 is retired) but tells the admin that incity quotes
 * from there will come back `PICKUP_OUTSIDE_CITY`, and they can only see that if the boundary is
 * on screen while they draw.
 *
 * Google's `Data` layer has no dash support, so this is the one thing that costs an extra
 * overlay: a `Polyline` whose stroke is transparent and whose dashes are repeated symbols.
 * `google.maps.SymbolPath.CIRCLE` would give dots; the two-point path below gives real dashes.
 */
export function cityBoundaryStroke(): google.maps.PolylineOptions {
  return {
    strokeOpacity: 0,
    icons: [
      {
        icon: {
          path: 'M 0,-1 0,1',
          strokeOpacity: 1,
          strokeColor: colors.zoneCity,
          strokeWeight: 2,
          scale: 3,
        },
        offset: '0',
        repeat: '12px',
      },
    ],
    zIndex: 2,
  };
}

/**
 * The offending area from a Z-2 overlap or a failed containment, painted above everything else.
 *
 * This is the whole reason `ZoneViolationDto` carries `offending_geometry` rather than only a
 * message: "Overlaps 'Central' by 0.42 km²" tells an admin there is a problem, and painting the
 * 0.42 km² tells them where to drag. Mongo cannot return derived geometry at all, which is why
 * Turf computes it server-side (docs/LLD/zones.md §Why MongoDB geo).
 */
export const VIOLATION_STYLE: google.maps.Data.StyleOptions = {
  fillColor: colors.zoneViolation,
  fillOpacity: 0.45,
  strokeColor: colors.zoneViolation,
  strokeWeight: 2,
  clickable: false,
  zIndex: 5,
};

/**
 * The polygon under edit. `interactive` ink, not one of the zone colours: it is the one shape on
 * screen that is not yet saved, and it should read as the thing being manipulated rather than as
 * a fifth category of zone.
 */
export const DRAFT_STYLE: google.maps.PolygonOptions = {
  fillColor: colors.interactive,
  fillOpacity: 0.22,
  strokeColor: colors.interactive,
  strokeWeight: 2.5,
  zIndex: 4,
};

export const EMPTY_COLLECTION: FeatureCollection<Polygon> = {
  type: 'FeatureCollection',
  features: [],
};
