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

  useImperativeHandle(ref, () => ({
    moveTo: (lat, lng, zoom) => {
      const delta = zoom === undefined ? region.current.latitudeDelta : ZOOM_DELTA[zoom];
      map.current?.animateToRegion(
        { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta },
        450,
      );
    },
  }));

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

  /**
   * Frame both points the first time a given pickup/drop pair appears. A later `bottomInset`
   * change (a row added to the sheet) must NOT re-frame and fight a customer who has since panned,
   * so the effect keys on the coordinate pair only and `bottomInset` is read fresh inside it.
   */
  const routeKey =
    pickup !== undefined && drop !== undefined
      ? `${pickup.lat},${pickup.lng}|${drop.lat},${drop.lng}`
      : null;

  /**
   * The latest pair and inset, mirrored into a ref so the effect below can read them without
   * listing them as dependencies — `pickup`/`drop` are fresh objects from `.find()` on every
   * render, and `bottomInset` changes whenever the sheet resizes. Only `routeKey` should trigger
   * a re-frame.
   */
  const latest = useRef({ pickup, drop, bottomInset });
  latest.current = { pickup, drop, bottomInset };

  useEffect(() => {
    if (routeKey === null) {
      framedTo.current = null;
      return;
    }
    if (routeKey === framedTo.current) return;
    framedTo.current = routeKey;

    const t = setTimeout(() => {
      const { pickup: p, drop: d, bottomInset: inset } = latest.current;
      if (p === undefined || d === undefined) return;
      map.current?.fitToCoordinates(
        [
          { latitude: p.lat, longitude: p.lng },
          { latitude: d.lat, longitude: d.lng },
        ],
        {
          edgePadding: { top: 90, right: 60, bottom: inset + 90, left: 60 },
          animated: true,
        },
      );
    }, 80);
    return () => clearTimeout(t);
  }, [routeKey]);

  return (
    <View style={styles.root}>
      <MapView
        ref={map}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={initialRegion}
        // The bottom strip the sheet covers — makes the map's centre the middle of what is
        // actually visible, so the crosshair and the reported coordinate agree.
        mapPadding={{ top: 0, right: 0, bottom: bottomInset, left: 0 }}
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
