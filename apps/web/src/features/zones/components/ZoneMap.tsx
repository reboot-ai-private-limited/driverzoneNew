'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { bbox } from '@turf/bbox';
import { polygon as turfPolygon } from '@turf/helpers';
import type { ZoneDto } from '@driverzone/contracts';
import type { Polygon } from '@driverzone/geo';
import { DEFAULT_CENTER, DEFAULT_ZOOM, loadMapLibraries, type MapTypeId } from '../lib/google-maps';
import { bboxToBounds, pathToPolygon, polygonToPath } from '../lib/google-geometry';
import {
  DRAFT_LINE_STYLE,
  DRAFT_STYLE,
  EMPTY_COLLECTION,
  VIOLATION_STYLE,
  cityBoundaryStroke,
  zoneFeatureStyle,
  zonesToFeatureCollection,
  type ZoneFeatureProperties,
} from '../lib/zone-layers';

export interface ZoneMapProps {
  zones: ZoneDto[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** True while a polygon is being traced or reshaped. Drives the whole draw lifecycle. */
  editing: boolean;
  /** The shape currently under edit — `null` means "nothing drawn yet, start a fresh polygon". */
  draft: Polygon | null;
  onDraftChange: (geometry: Polygon | null) => void;
  /** The offending area from the standing violation, painted above everything else. */
  violationGeometry: Polygon | null;
  mapType: MapTypeId;
  /** Bumping this number re-frames the map on the selection. A number, not a boolean: asking
   * twice for the same zone must work, and a boolean cannot express the second ask. */
  fitToken: number;
  /** Somewhere to hang the Places search box, which must live inside the map's own container. */
  onMapReady?: (map: google.maps.Map) => void;
}

export function ZoneMap({
  zones,
  selectedId,
  onSelect,
  editing,
  draft,
  onDraftChange,
  violationGeometry,
  mapType,
  fitToken,
  onMapReady,
}: ZoneMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const zoneData = useRef<google.maps.Data | null>(null);
  const violationData = useRef<google.maps.Data | null>(null);
  const cityOutline = useRef<google.maps.Polyline | null>(null);
  /** The clicks placed so far, and the open chain drawn through them, while a new zone is being
   * traced. Both are null except during a fresh draw. */
  const pending = useRef<google.maps.LatLng[]>([]);
  const chain = useRef<google.maps.Polyline | null>(null);
  const draftShape = useRef<google.maps.Polygon | null>(null);
  const pathListeners = useRef<google.maps.MapsEventListener[]>([]);

  /**
   * State, not a ref. The overlays only exist once the API has loaded, and every effect below
   * has to run again once they do. A ref would record that fact and re-render nothing.
   */
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * Handlers change identity every render; the map's listeners are bound once. Reading current
   * values through a ref is what keeps a click handler from closing over the props of the render
   * that happened to mount the map.
   */
  const latest = useRef({ onSelect, onDraftChange, editing });
  latest.current = { onSelect, onDraftChange, editing };

  // ── Mount ────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (container.current === null || map.current !== null) return;

    let cancelled = false;

    void loadMapLibraries()
      .then(({ maps }) => {
        // React 19 StrictMode mounts, unmounts and remounts. The load promise from the first
        // mount can settle after that teardown, and building a map into a detached node leaks
        // one silently.
        if (cancelled || container.current === null) return;

        const instance = new maps.Map(container.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeId: mapType,
          // The editor is a precision tool. A tilted or rotated map puts a polygon's corners
          // somewhere other than where the cursor is, and there is nothing here worth seeing
          // in 3D.
          tilt: 0,
          rotateControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
          // Double-click FINISHES a polygon here, so it must not also zoom. Disabled for the
          // whole map rather than toggled per mode: on an editor, double-click-to-zoom is worth
          // very little and a mode-dependent gesture is worth less than nothing.
          disableDoubleClickZoom: true,
        });

        const zoneLayer = new maps.Data({ map: instance });
        zoneLayer.setStyle((feature) =>
          zoneFeatureStyle({
            id: String(feature.getProperty('id') ?? ''),
            type: feature.getProperty('type') as ZoneDto['type'],
            name: String(feature.getProperty('name') ?? ''),
            charge: String(feature.getProperty('charge') ?? 'NONE'),
            selected: feature.getProperty('selected') === true,
            dimmed: feature.getProperty('dimmed') === true,
          } as ZoneFeatureProperties),
        );

        zoneLayer.addListener('click', (event: google.maps.Data.MouseEvent) => {
          // A click that lands on a zone while drawing is a vertex, not a selection.
          if (latest.current.editing) return;
          const id = event.feature.getProperty('id');
          if (typeof id === 'string') latest.current.onSelect(id);
        });

        const violationLayer = new maps.Data({ map: instance });
        violationLayer.setStyle(VIOLATION_STYLE);

        map.current = instance;
        zoneData.current = zoneLayer;
        violationData.current = violationLayer;
        setReady(true);
        onMapReady?.(instance);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setFailed(error instanceof Error ? error.message : 'Could not load the map.');
      });

    return () => {
      cancelled = true;
      for (const listener of pathListeners.current) listener.remove();
      pathListeners.current = [];
      draftShape.current?.setMap(null);
      cityOutline.current?.setMap(null);
      chain.current?.setMap(null);
      zoneData.current?.setMap(null);
      violationData.current?.setMap(null);
      draftShape.current = null;
      cityOutline.current = null;
      chain.current = null;
      pending.current = [];
      zoneData.current = null;
      violationData.current = null;
      map.current = null;
      setReady(false);
    };
    // Mount only. `mapType` is read once for the initial value and driven by its own effect
    // after that; re-running this would rebuild the entire map on a basemap toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Replace a Data layer's contents wholesale. Google has no `setData`, so it is remove-then-add. */
  const replaceFeatures = useCallback(
    (layer: google.maps.Data | null, collection: Parameters<google.maps.Data['addGeoJson']>[0]) => {
      if (layer === null) return;
      layer.forEach((feature) => layer.remove(feature));
      layer.addGeoJson(collection);
    },
    [],
  );

  // ── Saved zones ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;

    // While editing, the draft is rendered by its own editable Polygon, so the saved copy of the
    // same zone must come out of the Data layer — otherwise the old boundary sits underneath the
    // new one and the admin is looking at two polygons that are supposed to be one.
    const visible = editing ? zones.filter((zone) => zone.id !== selectedId) : zones;
    replaceFeatures(zoneData.current, zonesToFeatureCollection(visible, selectedId, editing));

    // The dashed city outline, redrawn alongside. Google's Data layer cannot dash a stroke, so
    // the city gets a Polyline of its own — see CITY_BOUNDARY_STROKE for why it is worth it.
    cityOutline.current?.setMap(null);
    cityOutline.current = null;

    const city = visible.find((zone) => zone.type === 'CITY');
    if (city !== undefined && map.current !== null) {
      const ring = polygonToPath(city.geometry);
      cityOutline.current = new google.maps.Polyline({
        // Closed explicitly: a Polyline does not join its ends the way a Polygon does.
        path: [...ring, ...(ring[0] === undefined ? [] : [ring[0]])],
        map: map.current,
        ...cityBoundaryStroke(),
      });
    }
  }, [ready, zones, selectedId, editing, replaceFeatures]);

  // ── Violation overlay ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    replaceFeatures(
      violationData.current,
      violationGeometry === null
        ? EMPTY_COLLECTION
        : { type: 'Feature', properties: {}, geometry: violationGeometry },
    );
  }, [ready, violationGeometry, replaceFeatures]);

  // ── Map type ─────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    map.current?.setMapTypeId(mapType);
  }, [ready, mapType]);

  // ── Framing ──────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || fitToken === 0 || map.current === null) return;

    const target = draft ?? zones.find((zone) => zone.id === selectedId)?.geometry ?? null;
    if (target === null) return;

    try {
      map.current.fitBounds(bboxToBounds(bbox(turfPolygon(target.coordinates))), 64);
    } catch {
      // A ring too short to have a bounding box. Nothing to frame, nothing to report.
    }
    // `draft` is deliberately absent: re-framing on every vertex drag would fight the admin for
    // control of the viewport. Only an explicit `fitToken` bump re-frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, fitToken]);

  // ── Draw / edit ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || map.current === null) return;
    const instance = map.current;

    /** Read the live path back out and hand it up. One place, so both flows agree. */
    const publish = (shape: google.maps.Polygon): void => {
      latest.current.onDraftChange(pathToPolygon(shape.getPath()));
    };

    /**
     * A Google polygon reports vertex edits through its PATH, not through itself: dragging a
     * corner fires `set_at`, the midpoint handle fires `insert_at`, and right-click-delete fires
     * `remove_at`. Miss any one and the shape on screen silently stops matching the shape being
     * validated — which on this screen means a boundary that saves as something other than what
     * was drawn.
     */
    const watch = (shape: google.maps.Polygon): void => {
      const path = shape.getPath();
      pathListeners.current.push(
        path.addListener('set_at', () => publish(shape)),
        path.addListener('insert_at', () => publish(shape)),
        path.addListener('remove_at', () => publish(shape)),
      );
    };

    const teardown = (): void => {
      for (const listener of pathListeners.current) listener.remove();
      pathListeners.current = [];
      draftShape.current?.setMap(null);
      draftShape.current = null;
      chain.current?.setMap(null);
      chain.current = null;
      pending.current = [];
      instance.setOptions({ draggableCursor: null });
    };

    if (!editing) {
      teardown();
      return;
    }

    if (draft !== null) {
      // Reshaping something that already has a boundary — imported, or an existing zone.
      const shape = new google.maps.Polygon({
        paths: polygonToPath(draft),
        map: instance,
        ...DRAFT_STYLE,
        editable: true,
        draggable: false,
      });
      draftShape.current = shape;
      watch(shape);
      return teardown;
    }

    /**
     * TRACING A NEW POLYGON, BY HAND.
     *
     * `DrawingManager` used to do this and was REMOVED from the Maps JavaScript API in v3.65 —
     * its constructor now throws. (`@types/google.maps` says so too, by declaring the class with
     * an empty body; that is a removal notice, not a gap in the typings.)
     *
     * What it did is not much: collect clicks, draw the chain between them, and close the shape
     * on a double-click. Doing it here costs a few lines and means the interaction is ours —
     * including the two keyboard escapes below, which `DrawingManager` never offered.
     *
     * The chain is a POLYLINE, not a polygon. A two-point polygon is a degenerate shape whose
     * rendering is not worth relying on, whereas a polyline through the same points is exactly
     * the open path the user is building.
     */
    instance.setOptions({ draggableCursor: 'crosshair' });

    /**
     * Where the pointer is right now, once at least one corner is down.
     *
     * This is what makes the chain a RUBBER BAND rather than a record of past clicks: the
     * segment from the last placed corner to the cursor is drawn before the next click happens,
     * so the admin sees the edge they are about to commit to. Without it the first click puts a
     * single point on the map — which a polyline renders as nothing at all — and the screen looks
     * like it ignored the click until a second one lands.
     */
    let hover: google.maps.LatLng | null = null;
    /** Coalesces redraws to one per frame; `mousemove` fires far faster than the map repaints. */
    let frame = 0;

    const redraw = (): void => {
      if (chain.current === null) {
        chain.current = new google.maps.Polyline({ map: instance, ...DRAFT_LINE_STYLE });
      }
      chain.current.setPath(hover === null ? pending.current : [...pending.current, hover]);
    };

    /** Close the ring and hand over to the editable polygon. Below three corners there is
     * nothing to close, so the gesture is ignored rather than producing a broken shape. */
    const finish = (): void => {
      if (pending.current.length < 3) return;
      // The band dies with the trace — leaving it set would draw a segment to a stale cursor
      // position on the next redraw.
      hover = null;

      const shape = new google.maps.Polygon({
        paths: pending.current,
        map: instance,
        ...DRAFT_STYLE,
        editable: true,
        draggable: false,
      });

      chain.current?.setMap(null);
      chain.current = null;
      pending.current = [];
      instance.setOptions({ draggableCursor: null });

      draftShape.current = shape;
      watch(shape);
      publish(shape);
    };

    const cancel = (): void => {
      hover = null;
      chain.current?.setMap(null);
      chain.current = null;
      pending.current = [];
      latest.current.onDraftChange(null);
    };

    const clickListener = instance.addListener('click', (event: google.maps.MapMouseEvent) => {
      if (event.latLng === null) return;
      pending.current = [...pending.current, event.latLng];
      redraw();
    });

    /**
     * The rubber band itself.
     *
     * Ignored until the first corner exists — before that there is nothing to draw a line FROM,
     * and a band anchored to nowhere would just be a dot chasing the cursor.
     */
    const moveListener = instance.addListener('mousemove', (event: google.maps.MapMouseEvent) => {
      if (event.latLng === null || pending.current.length === 0) return;
      hover = event.latLng;

      // rAF rather than the 100 ms throttle used for map pans: a band that updates ten times a
      // second reads as lag on a gesture the eye is following continuously.
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        redraw();
      });
    });

    /**
     * A double-click arrives as click, click, dblclick — so by the time this runs, the final
     * point has been added TWICE. Dropping one is what makes "double-click to finish" place the
     * last corner where the user actually clicked rather than stacking two corners on it.
     */
    const doubleClickListener = instance.addListener('dblclick', () => {
      pending.current = pending.current.slice(0, -1);
      finish();
    });

    const onKey = (event: KeyboardEvent): void => {
      // The inspector's name and code fields are on the same screen. Enter in a text field
      // means "submit that field", never "close this polygon".
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable]')) {
        return;
      }
      if (event.key === 'Enter') finish();
      if (event.key === 'Escape') cancel();
    };

    window.addEventListener('keydown', onKey);

    return () => {
      clickListener.remove();
      moveListener.remove();
      doubleClickListener.remove();
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      teardown();
    };
    // `draft` is not a dependency on purpose. It changes on every vertex drag, and re-running
    // this would rebuild the polygon mid-gesture — it would vanish under the cursor. The draft
    // is READ here once, when editing begins; the effect below is how an import gets in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, editing]);

  /**
   * A GeoJSON import lands while an edit session is already open, so it cannot go through the
   * effect above without tearing down the shape being edited. Watching `draft` here instead and
   * rebuilding only when it disagrees with what is on screen keeps the drag path untouched.
   */
  useEffect(() => {
    if (!ready || !editing || draft === null || map.current === null) return;

    const onScreen = draftShape.current;
    if (onScreen !== null) {
      const current = pathToPolygon(onScreen.getPath());
      if (current !== null && JSON.stringify(current) === JSON.stringify(draft)) return;
    }

    for (const listener of pathListeners.current) listener.remove();
    pathListeners.current = [];
    onScreen?.setMap(null);
    // An import can land mid-trace: drop the half-drawn chain, the imported shape replaces it.
    chain.current?.setMap(null);
    chain.current = null;
    pending.current = [];

    const shape = new google.maps.Polygon({
      paths: polygonToPath(draft),
      map: map.current,
      ...DRAFT_STYLE,
      editable: true,
      draggable: false,
    });
    draftShape.current = shape;

    const path = shape.getPath();
    const publish = (): void => latest.current.onDraftChange(pathToPolygon(path));
    pathListeners.current.push(
      path.addListener('set_at', publish),
      path.addListener('insert_at', publish),
      path.addListener('remove_at', publish),
    );
  }, [ready, editing, draft]);

  if (failed !== null) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6 bg-surface-muted">
        <p className="text-xs text-danger text-center max-w-sm">{failed}</p>
      </div>
    );
  }

  return (
    <div
      ref={container}
      className="absolute inset-0"
      // The map is a canvas of polygons with no text alternative worth writing. The rail beside
      // it lists every zone by name with the same selection state, and THAT is the accessible
      // path through this screen — see `ZoneRail`.
      role="application"
      aria-label="Zone map"
    />
  );
}
