import {
  type ReactElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
  type Region,
} from 'react-native-maps';
import { colors, radius } from '@/theme/theme';

/**
 * THE MAP IS A LEAF, AND THIS FILE IS THE ONLY THING THAT KNOWS WHAT DRAWS IT.
 *
 * `docs/engineering/tech-choices.md` records the admin panel's map swap and what made it cheap:
 * *"The map is a LEAF: swapping it touched `ZoneMap.tsx`… Keep it that way."* Same rule here.
 * This file has been Google's native `react-native-maps`, then Leaflet-in-a-WebView, and is now
 * native again — and the screen has not changed for any of it: every prop below is plain lat/lng,
 * never a map library's own types.
 *
 * **Native Google map, both platforms.** Android reads the key from
 * `com.google.android.geo.API_KEY` in the manifest, iOS from `GMSApiKey` in the Info.plist —
 * both come from `app.config.ts` (`GOOGLE_MAPS_ANDROID_API_KEY` / `GOOGLE_MAPS_IOS_API_KEY` in
 * `apps/customer/.env`). WITHOUT a key the map renders as a blank grey grid: Expo Go supplies its
 * own Android key so it works there, but a dev-client or store build needs the real ones.
 */

export interface MapCanvasHandle {
  /** Recentres with animation. `zoom` omitted keeps the current zoom. */
  moveTo: (lat: number, lng: number, zoom?: MapZoom) => void;
}

export type MapZoom = 'street' | 'city';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: 'pickup' | 'drop';
  title: string;
}

interface MapCanvasProps {
  initialCentre: { lat: number; lng: number };
  markers?: MapMarker[];
  /** The fixed crosshair used while the customer is positioning a point. */
  showCentrePin?: boolean;
  /** Whether the centre pin is picking pickup or drop/destination. */
  centrePinKind?: 'pickup' | 'drop';
  /** The customer's own position, when known. Drawn as the familiar blue dot. */
  userLocation?: { lat: number; lng: number } | null;
  /**
   * How many points at the bottom of the map are COVERED by the sheet.
   *
   * Passed to the native map as bottom padding, so the map's own idea of "centre" is the middle
   * of the VISIBLE strip — which is where the crosshair sits and what `onRegionSettled` must
   * report. Without it the reported coordinate is the one behind the sheet.
   */
  bottomInset?: number;
  /**
   * `| undefined` is not noise: the app compiles with `exactOptionalPropertyTypes`, under which
   * `?: T` refuses an explicitly-passed `undefined`. The screen turns this handler off by
   * passing `undefined` while the map is idle, which is exactly that case.
   */
  onRegionSettled?: ((lat: number, lng: number) => void) | undefined;
}

/**
 * Latitude spans for the two zoom presets — "a few streets" and "a whole city". Longitude delta
 * is derived from the view's aspect ratio by the map itself when only latitudeDelta is animated,
 * so a single number per preset is enough.
 */
const ZOOM_DELTA: Record<MapZoom, number> = { street: 0.006, city: 0.06 };

/** The apex of the route's bow, as a fraction of the straight-line distance. */
const ROUTE_ARC = 0.14;

/**
 * The padding passed before the map is ready. A module-level constant so its IDENTITY never
 * changes — see the crash note on `mapPadding` in the component.
 */
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * The most of the map that framing a route is allowed to pad away, per axis.
 *
 * WHY A CAP IS NEEDED AT ALL. `fitToCoordinates`' bottom padding is the sheet's height plus a
 * margin, and the sheet can be most of the screen — a trip summary with options and a button
 * easily runs past half of it. Once `top + bottom` approaches the map's own height there is no
 * rectangle left to fit two points into, and Google's camera solver does not degrade gracefully:
 * it returns a frame with the pins outside it, or declines to move at all. Either way the customer
 * picks a pickup and a destination and the route simply never appears.
 *
 * Capping at 70% leaves a usable strip whatever the sheet is doing. It only ever bites when the
 * padding was already impossible, so a normal-sized sheet frames exactly as before.
 */
const MAX_FIT_PADDING_RATIO = 0.7;

/**
 * How long after a new pickup/drop pair appears a sheet resize may still correct the framing.
 * Module scope, so the effect that reads it needs no dependency on it.
 */
const FRAME_SETTLE_MS = 1200;

/**
 * Shrinks a pair of opposite paddings proportionally until they fit inside `extent`.
 *
 * PROPORTIONALLY, rather than clamping each to half the budget: the two sides mean different
 * things here — the bottom is a sheet covering the map, the top is a bar floating over it — and
 * clamping them independently would hand a 40pt top margin the same allowance as a 500pt sheet
 * and push the route up behind the sheet anyway.
 */
function fitWithin(near: number, far: number, extent: number): { near: number; far: number } {
  const budget = extent * MAX_FIT_PADDING_RATIO;
  const total = near + far;
  if (extent <= 0 || total <= budget) return { near, far };

  const scale = budget / total;
  return { near: Math.floor(near * scale), far: Math.floor(far * scale) };
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    initialCentre,
    markers = [],
    showCentrePin = false,
    centrePinKind = 'pickup',
    userLocation = null,
    bottomInset = 0,
    onRegionSettled,
  },
  ref,
): ReactElement {
  const map = useRef<MapView>(null);

  /** Last region the map settled on — so `moveTo` without a zoom can keep the current span. */
  const region = useRef<Region>({
    latitude: initialCentre.lat,
    longitude: initialCentre.lng,
    latitudeDelta: ZOOM_DELTA.city,
    longitudeDelta: ZOOM_DELTA.city,
  });

  /** The pickup/drop pair the map was last framed to, so it re-fits once per NEW pair only. */
  const framedTo = useRef<string | null>(null);

  /**
   * This view's own size, so framing can be clamped against it — see `MAX_FIT_PADDING_RATIO`.
   *
   * A ref, not state: nothing renders differently for it, and the map is full-bleed, so a state
   * update here would re-render the whole canvas on every rotation for a value only one callback
   * reads. Zero until the first layout, which `fitWithin` treats as "no clamp".
   */
  const size = useRef({ width: 0, height: 0 });

  const initialRegion = useMemo<Region>(
    () => ({
      latitude: initialCentre.lat,
      longitude: initialCentre.lng,
      latitudeDelta: ZOOM_DELTA.city,
      longitudeDelta: ZOOM_DELTA.city,
    }),
    // First value only — the map keeps its own region after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * True once `getMapAsync` has delivered the native `GoogleMap`.
   *
   * EVERY route into the native map is gated on this — `mapPadding`, `fitToCoordinates` and
   * `animateToRegion` all reach the same instance, and under the new architecture the view is laid
   * out and taking props before that instance exists. See the crash note on `mapPadding`.
   */
  const [mapReady, setMapReady] = useState(false);

  /**
   * A `moveTo` that arrived before the native map existed, held for the `onMapReady` flush.
   *
   * Not dropped, because the earliest callers are real: the screen recentres on the customer's
   * location as soon as it resolves, which can beat `getMapAsync`. Dropping it would leave the map
   * sitting on `initialCentre` with no way back until the customer panned.
   */
  const pendingMove = useRef<{ lat: number; lng: number; zoom?: MapZoom } | null>(null);

  const applyMove = (lat: number, lng: number, zoom?: MapZoom): void => {
    const delta = zoom === undefined ? region.current.latitudeDelta : ZOOM_DELTA[zoom];
    map.current?.animateToRegion(
      { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta },
      450,
    );
  };

  useImperativeHandle(ref, () => ({
    moveTo: (lat, lng, zoom) => {
      // Same null-map hazard as `mapPadding` and `fitToCoordinates` — hold it rather than reach
      // into a map that is not there yet.
      if (!mapReady) {
        pendingMove.current = zoom === undefined ? { lat, lng } : { lat, lng, zoom };
        return;
      }
      applyMove(lat, lng, zoom);
    },
  }));

  useEffect(() => {
    if (!mapReady) return;
    const queued = pendingMove.current;
    pendingMove.current = null;
    if (queued !== null) applyMove(queued.lat, queued.lng, queued.zoom);
    // `applyMove` closes only over refs, so it needs no dependency of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  const pickup = markers.find((m) => m.kind === 'pickup');
  const drop = markers.find((m) => m.kind === 'drop');

  const route = useMemo(
    () => (pickup !== undefined && drop !== undefined ? curvedPath(pickup, drop) : null),
    // Recompute only when a coordinate actually moves — `pickup`/`drop` are fresh objects from
    // `.find()` on every render, so depending on them would rebuild the 48-point path each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickup?.lat, pickup?.lng, drop?.lat, drop?.lng],
  );

  /**
   * `<Marker>` with a custom child renders BLANK on Android if `tracksViewChanges` is false from
   * the first frame — the native view needs at least one snapshot pass. So it starts true and is
   * switched off a moment later, once the pins have rasterised. From then on the markers are
   * static bitmaps and cost nothing on pan/zoom.
   */
  const [tracksChanges, setTracksChanges] = useState(true);
  // A signature of the current marker set — changes when a pin is added/removed or the user dot
  // appears/disappears, which is when a fresh snapshot pass is needed.
  const markerSignature = `${markers.length}:${userLocation === null ? 'no-user' : 'user'}`;
  useEffect(() => {
    setTracksChanges(true);
    const t = setTimeout(() => setTracksChanges(false), 1200);
    return () => clearTimeout(t);
  }, [markerSignature]);

  /** When the current pair was first framed — see the settle window in the effect below. */
  const framedAt = useRef(0);

  /**
   * Frame both points the first time a given pickup/drop pair appears — and again if the sheet
   * resizes in the moment right after, while the frame is still settling.
   *
   * THE SETTLE WINDOW IS A FIX, not a refinement. Confirming a destination does two things at
   * once: the drop marker appears, and the sheet below swaps a short "where to?" panel for a full
   * trip summary. The sheet's new height arrives a frame or two AFTER the marker, so the fit ran
   * against the old, much smaller inset and framed the route low — squarely behind the sheet that
   * was about to grow over it. Which looks exactly like the map never framing the ride at all.
   *
   * A LATER inset change must still not re-frame: a customer who has since dragged the sheet to
   * look around would have the map yanked back under them. So the window is short, and only a
   * genuinely new pair reopens it.
   */
  const routeKey =
    pickup !== undefined && drop !== undefined
      ? `${pickup.lat},${pickup.lng}|${drop.lat},${drop.lng}`
      : null;

  /**
   * The latest pair and inset, mirrored into a ref so the effect below can read them at the
   * moment it fires rather than as they were when it was scheduled.
   *
   * `pickup`/`drop` are fresh objects from `.find()` on every render, so depending on them would
   * re-run the effect constantly. `bottomInset` IS a dependency — a sheet that grows right after
   * a route appears has to be allowed to correct the frame — but it is still read from here, so
   * the 80ms debounce uses the height as it stands when the fit actually runs.
   */
  const latest = useRef({ pickup, drop, bottomInset });
  latest.current = { pickup, drop, bottomInset };

  useEffect(() => {
    if (routeKey === null) {
      framedTo.current = null;
      return;
    }
    // Wait for the native map. `fitToCoordinates` reaches the same `GoogleMap` instance that
    // `mapPadding` does, and calling it early has the same null-dereference shape. `mapReady` is
    // in the dependency list rather than an early bail so the pair still gets framed once the map
    // arrives, and `framedTo` is only claimed when the work is genuinely scheduled — bailing after
    // setting it would mark the pair as framed and silently never frame it.
    if (!mapReady) return;

    const isNewPair = routeKey !== framedTo.current;
    const settling = Date.now() - framedAt.current < FRAME_SETTLE_MS;
    if (!isNewPair && !settling) return;

    framedTo.current = routeKey;
    if (isNewPair) framedAt.current = Date.now();

    const t = setTimeout(() => {
      const { pickup: p, drop: d, bottomInset: inset } = latest.current;
      if (p === undefined || d === undefined) return;

      /*
       * CLAMPED AGAINST THE MAP'S OWN SIZE. `inset + 90` is whatever the sheet happens to be, and
       * on a trip-summary sheet that is most of the screen — see `MAX_FIT_PADDING_RATIO`. The
       * size comes from this view's own `onLayout`; before that has landed there is nothing to
       * clamp against and the raw values go through, which is correct, since a map that has not
       * been laid out has no visible strip to protect.
       */
      const { width, height: viewHeight } = size.current;
      const vertical = fitWithin(90, inset + 90, viewHeight);
      const horizontal = fitWithin(60, 60, width);

      map.current?.fitToCoordinates(
        [
          { latitude: p.lat, longitude: p.lng },
          { latitude: d.lat, longitude: d.lng },
        ],
        {
          edgePadding: {
            top: vertical.near,
            bottom: vertical.far,
            left: horizontal.near,
            right: horizontal.far,
          },
          animated: true,
        },
      );
    }, 80);
    return () => clearTimeout(t);
    // `bottomInset` IS a dependency now — that is what lets the sheet's arriving height correct a
    // frame drawn a moment before it. The guard above is what stops it re-framing forever after.
  }, [routeKey, mapReady, bottomInset]);

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const { width, height: measured } = event.nativeEvent.layout;
        size.current = { width, height: measured };
      }}
    >
      <MapView
        ref={map}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        onMapReady={() => setMapReady(true)}
        /**
         * The bottom strip the sheet covers — makes the map's centre the middle of what is
         * actually visible, so the crosshair and the reported coordinate agree.
         *
         * WITHHELD UNTIL `onMapReady`, and that is a crash fix, not caution.
         * `MapView.applyBaseMapPadding` guards on the VIEW being laid out but not on the
         * `GoogleMap` existing, and under the new architecture those are different moments:
         * `getMapAsync` can still be in flight after layout. The sheet reports its height through
         * `onLayout` almost immediately, so `bottomInset` went 0 → N right in that window — a
         * padding CHANGE, past the layout guard, straight into
         * `NullPointerException: GoogleMap.setPadding(...) on a null object reference`.
         *
         * `NO_PADDING` is a module constant so its identity is stable: before the map is ready the
         * prop never changes, so the only `setMapPadding` call is the pre-layout one that defers
         * harmlessly.
         */
        mapPadding={mapReady ? { top: 0, right: 0, bottom: bottomInset, left: 0 } : NO_PADDING}
        // Only the SETTLED region is needed — for `onRegionSettled` and for `moveTo` to keep the
        // current span when no zoom is passed. The intermediate `onRegionChange` stream is noise.
        onRegionChangeComplete={(next) => {
          region.current = next;
          onRegionSettled?.(next.latitude, next.longitude);
        }}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        // The explicit `userLocation` prop is the source of truth; the OS blue dot would be a
        // second, possibly-disagreeing one.
        showsUserLocation={false}
        loadingEnabled
        loadingBackgroundColor={colors.bgSunken}
      >
        {route !== null ? (
          <>
            {/* A wide, faint line for lift — the nearest a native polyline gets to a soft glow. */}
            <Polyline
              coordinates={route}
              strokeColor={withAlpha(colors.fg, 0.16)}
              strokeWidth={9}
              lineCap="round"
              lineJoin="round"
            />
            {/* The line itself. */}
            <Polyline
              coordinates={route}
              strokeColor={colors.fg}
              strokeWidth={3.5}
              lineCap="round"
              lineJoin="round"
            />
            {/* A thin brand-yellow dashed accent on top, pointing the way. */}
            <Polyline
              coordinates={route}
              strokeColor={colors.brand}
              strokeWidth={3}
              lineDashPattern={[2, 12]}
              lineCap="round"
            />
          </>
        ) : null}

        {markers.map((m) => (
          <Marker
            key={m.id}
            identifier={m.id}
            coordinate={{ latitude: m.lat, longitude: m.lng }}
            title={m.title}
            anchor={m.kind === 'drop' ? { x: 0.5, y: 1 } : { x: 0.5, y: 0.5 }}
            tracksViewChanges={tracksChanges}
          >
            {m.kind === 'pickup' ? <PickupGlyph /> : <DropGlyph />}
          </Marker>
        ))}

        {userLocation !== null ? (
          <Marker
            coordinate={{ latitude: userLocation.lat, longitude: userLocation.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={tracksChanges}
            // Behind the pickup/drop markers — it is context, not the point being chosen.
            zIndex={0}
          >
            <UserDotGlyph />
          </Marker>
        ) : null}
      </MapView>

      {showCentrePin ? (
        // OUTSIDE the map, inset from the bottom by the sheet's height so it lands in the middle
        // of what the customer can SEE. The pin stays still and the map moves under it — dragging
        // a marker instead means fighting the pan gesture for the same finger.
        <View style={[styles.centrePin, { bottom: bottomInset }]} pointerEvents="none">
          <View
            style={[styles.centrePinHead, centrePinKind === 'drop' && styles.centrePinHeadDrop]}
          />
          <View style={styles.centrePinStem} />
          <View style={styles.centrePinShadow} />
        </View>
      ) : null}
    </View>
  );
});

/**
 * PICKUP — an ink dot inside a soft brand halo. "This is where you are" reads at a glance and
 * needs no label. Static rather than pulsing: an infinite animation inside a native map marker
 * forces `tracksViewChanges` on, which re-rasterises the marker every frame and is a known
 * Android jank source. The halo carries the "live" feel without the cost.
 */
function PickupGlyph(): ReactElement {
  return (
    <View style={styles.pickupWrap}>
      <View style={styles.pickupHalo} />
      <View style={styles.pickupCore} />
    </View>
  );
}

/**
 * DESTINATION — a flat, branded teardrop: ink body, a yellow core, one white hairline for
 * contrast against any map colour. Not the stock red Google pin, and no gradient — brand yellow
 * is a flat surface everywhere else in this app.
 */
function DropGlyph(): ReactElement {
  return (
    <View style={styles.dropWrap}>
      <View style={styles.dropBody}>
        <View style={styles.dropCore} />
      </View>
      <View style={styles.dropTip} />
      <View style={styles.dropShadow} />
    </View>
  );
}

/** The customer's own position — the familiar Google blue dot with a soft accuracy ring. */
function UserDotGlyph(): ReactElement {
  return (
    <View style={styles.userWrap}>
      <View style={styles.userRing} />
      <View style={styles.userDot} />
    </View>
  );
}

/**
 * A quadratic-bezier bow between two coordinates — a deliberate curve, not a route: this app
 * draws the straight-line relationship, never the road. The control point is offset
 * perpendicular to the chord by `ROUTE_ARC` of its length, always to the same side so the bow
 * does not flip as the pair rotates. Ported from the previous Leaflet build.
 */
function curvedPath(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { latitude: number; longitude: number }[] {
  const midLat = (a.lat + b.lat) / 2;
  const midLng = (a.lng + b.lng) / 2;

  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const dx = (b.lng - a.lng) * cosLat;
  const dy = b.lat - a.lat;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.00001) {
    return [
      { latitude: a.lat, longitude: a.lng },
      { latitude: b.lat, longitude: b.lng },
    ];
  }

  let nx = -dy / dist;
  let ny = dx / dist;
  // Keep the bow on a consistent side.
  if (ny < -0.05 || (Math.abs(ny) <= 0.05 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }

  const arc = dist * ROUTE_ARC;
  const ctrlLat = midLat + ny * arc;
  const ctrlLng = midLng + (nx * arc) / cosLat;

  const points: { latitude: number; longitude: number }[] = [];
  const steps = 48;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const lat = u * u * a.lat + 2 * u * t * ctrlLat + t * t * b.lat;
    const lng = u * u * a.lng + 2 * u * t * ctrlLng + t * t * b.lng;
    points.push({ latitude: lat, longitude: lng });
  }
  return points;
}

/** `#RRGGBB` + alpha 0..1 → `#RRGGBBAA`. The theme colours are plain hex. */
function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

const styles = StyleSheet.create({
  // Written out rather than `StyleSheet.absoluteFillObject`, which React Native 0.86's types no
  // longer expose (`absoluteFill` is a registered style ID, not a spreadable object).
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  map: { flex: 1, backgroundColor: colors.bgSunken },

  // ── Pickup ──────────────────────────────────────────────────────────────────────────────────
  pickupWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  pickupHalo: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: withAlpha(colors.brand, 0.35),
  },
  pickupCore: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.fg,
    borderWidth: 2.5,
    borderColor: colors.brand,
  },

  // ── Destination ─────────────────────────────────────────────────────────────────────────────
  dropWrap: { width: 30, height: 40, alignItems: 'center' },
  dropBody: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.fg,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropCore: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: colors.brand },
  dropTip: {
    width: 2,
    height: 12,
    marginTop: -2,
    backgroundColor: colors.fg,
  },
  dropShadow: {
    width: 10,
    height: 3,
    borderRadius: 5,
    backgroundColor: 'rgba(0,0,0,0.22)',
    marginTop: 1,
  },

  // ── User dot ────────────────────────────────────────────────────────────────────────────────
  userWrap: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  userRing: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(26,115,232,0.18)',
  },
  userDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#1A73E8',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },

  // ── Centre crosshair (overlay, not on the map) ─────────────────────────────────────────────
  centrePin: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centrePinHead: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    borderWidth: 4,
    borderColor: colors.brand,
    marginBottom: -2,
  },
  centrePinHeadDrop: { backgroundColor: colors.brand, borderColor: colors.fg },
  centrePinStem: { width: 2, height: 16, backgroundColor: colors.fg },
  centrePinShadow: {
    width: 10,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
});
