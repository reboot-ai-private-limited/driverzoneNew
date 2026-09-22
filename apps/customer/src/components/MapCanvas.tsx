import {
  type MutableRefObject,
  type ReactElement,
  type RefObject,
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
  /**
   * Recentres with animation. `zoom` omitted keeps the current zoom.
   *
   * RETURNS WHETHER THE CAMERA WAS DRIVEN NOW. `false` means the native map did not exist yet and
   * the move was queued for the `onMapReady` flush — it will very probably still happen, but a
   * caller that only gets one chance at recentring must not spend it on a maybe. The home screen
   * reads this to decide whether its "already centred" latch may close; see `hasCentred` there.
   */
  moveTo: (lat: number, lng: number, zoom?: MapZoom) => boolean;
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
  /** How far out the map starts. Ignored after the first frame — the map keeps its own region. */
  initialZoom?: MapZoom;
  markers?: MapMarker[];
  /**
   * Whether a pickup/drop pair pulls the camera back to show both.
   *
   * TRUE IS FOR CHOOSING A TRIP, where the question is "where does this go" and both ends have to
   * be on screen. FALSE is for watching one, where the question is "who is coming to ME": the
   * search screen centres on the pickup the customer is standing at and lets the route bow run off
   * the edge, because a camera pulled back far enough to include a drop 40km away puts their own
   * street under a single pixel.
   */
  frameRoute?: boolean;
  /**
   * Whether the customer may pan and zoom.
   *
   * FALSE MAKES THE CAMERA A FACT rather than a starting position. The search screen draws its
   * sweep as a fixed screen-space overlay in the middle of the visible strip, which is over the
   * pickup only for as long as the camera stays there — one drag and the rings would be pulsing
   * over an empty field while the pin they belong to sat off to one side. Nothing on that screen
   * asks the customer to look around, so the gesture that would break it is simply not offered.
   */
  interactive?: boolean;
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
 * How long after a new pickup/drop pair appears a sheet resize may still correct the framing.
 * Module scope, so the effect that reads it needs no dependency on it.
 */
const FRAME_SETTLE_MS = 1200;

/**
 * Breathing room above the route, clear of the floating search bar — AT MOST.
 *
 * It is a ceiling, not an amount, because the sheet decides how much map there is to breathe in.
 * The trip-summary sheet takes three quarters of the screen, leaving a strip of about 160dp;
 * spending 80 of those on a top margin and 40 on a bottom one leaves the route 40dp and puts its
 * middle nowhere near the middle of what the customer can see. Below, both are capped to a
 * fraction of the strip, so on a tall sheet they shrink instead of swallowing it.
 */
const FRAME_MARGIN_TOP = 80;

/** Ceiling on the room between the route and the top edge of the sheet. */
const FRAME_MARGIN_BOTTOM = 40;

/** The largest share of the visible strip each margin may take. */
const FRAME_MARGIN_TOP_SHARE = 0.25;
const FRAME_MARGIN_BOTTOM_SHARE = 0.15;

/** Breathing room either side. */
const FRAME_MARGIN_SIDE = 50;

/**
 * The smallest strip the route is ever framed into — a guard against dividing by nothing, not a
 * preference.
 *
 * IT USED TO BE 160, AND THAT WAS THE BUG. With a tall sheet the real strip is smaller than that,
 * so the floor took over and the band stopped describing where the strip was — while the aim was
 * still being derived FROM the band. The route was framed into a 160dp band beginning 80dp down,
 * which on that screen is behind the sheet's top edge: pickup clinging to the top corner, drop
 * not on screen at all.
 *
 * A route squeezed into a genuinely thin strip is zoomed a long way out, and that is the right
 * answer — when three quarters of the screen is sheet, there is nowhere else for the trip to go.
 * Visible and distant beats close-up and hidden.
 */
const MIN_FRAME_BAND = 60;

/**
 * How much wider than the two points the frame is drawn.
 *
 * Without slack the pins land exactly on the edges of the band, which reads as a route cropped
 * rather than framed.
 */
const FRAME_ZOOM_SLACK = 1.25;

/** The smallest span a frame will zoom to — two points metres apart must not fill the street. */
const MIN_FRAME_SPAN = 0.004;

/**
 * How long after a camera move of our own the map's settle report is ignored.
 *
 * THIS IS A CORRECTNESS FIX, NOT A POLISH ONE. `onRegionChangeComplete` is the screen's ONLY
 * signal for "the customer panned the map", and the address under the crosshair is re-geocoded
 * from it. But Android fires it DURING a programmatic animation as well — measured at 271ms into
 * a 450ms move, with the camera still 1.7km short of the target. A place chosen from search
 * therefore reported a coordinate somewhere along the flight path, and the pin was dropped there
 * instead: the "sometimes it pins the wrong place" bug, worse the further the map had to travel.
 *
 * So every move this component makes marks a window, and reports inside it update the remembered
 * region — which must stay truthful — without being passed on as the customer's choice. The tail
 * covers the stragglers that arrive just after the animation's nominal end.
 */
const SETTLE_SUPPRESSION_TAIL_MS = 400;

/**
 * A jump this far is made INSTANTLY rather than flown. Roughly five kilometres.
 *
 * GOOGLE MAPS GIVES UP ON A LONG FLY-OVER, and it does so at a much shorter distance than it
 * sounds. Two measurements, both on this device:
 *
 * - Kolkata, ~3.4° away: asked for 22.600, 88.385 at delta 0.006, the camera came to rest at
 *   26.004, 88.416 at delta 0.729 — hundreds of kilometres short, at a hundred times the span.
 * - Jalpaiguri Road Station, only ~0.3° away: the camera stopped over Siliguri College, about
 *   a third of the way, and stayed there.
 *
 * So the threshold is not "another city" but "further than the customer can see": beyond a few
 * screens' worth there is no continuity to follow anyway, and the animation is what loses the
 * target. A cut always lands.
 */
const LONG_JUMP_DEGREES = 0.05;

/*
 * THE CROSSHAIR'S GEOMETRY, so its tip can be put on the coordinate it claims.
 *
 * The pin is drawn as a stack — head, stem, ground shadow — and its container centres that stack
 * in the visible strip. Centring puts the stack's MIDDLE on the map's centre, which leaves the
 * spike's tip sitting below the point actually being reported. Every pick was off by that much,
 * consistently and in the same direction: far enough to land across a road or on the wrong side
 * of a junction.
 */
const CENTRE_PIN_HEAD = 22;
const CENTRE_PIN_HEAD_OVERLAP = 2;
const CENTRE_PIN_STEM = 16;
const CENTRE_PIN_SHADOW = 4;

/** Head, stem and shadow together. */
const PIN_STACK_HEIGHT =
  CENTRE_PIN_HEAD - CENTRE_PIN_HEAD_OVERLAP + CENTRE_PIN_STEM + CENTRE_PIN_SHADOW;

/** Where the stem meets the ground, measured from the top of the stack. */
const PIN_TIP_FROM_TOP = CENTRE_PIN_HEAD - CENTRE_PIN_HEAD_OVERLAP + CENTRE_PIN_STEM;

/** How far the stack is lifted so its tip, not its middle, lands on the centre. */
const PIN_TIP_LIFT = PIN_TIP_FROM_TOP - PIN_STACK_HEIGHT / 2;

/**
 * How long a flown move takes.
 *
 * Also the length of the settle-suppression window it opens, so both move together.
 */
const CAMERA_FLY_MS = 450;

/**
 * The "duration" of a cut.
 *
 * NOT ZERO. `GoogleMap.animateCamera` rejects a non-positive duration outright, and
 * `react-native-maps` passes ours straight through — so a cut is the shortest POSITIVE animation
 * instead, which the map renders as a jump.
 */
const CAMERA_CUT_MS = 1;

/**
 * How long after `onMapReady` the queued first move waits — see the flush effect for why it must
 * wait at all.
 *
 * Long enough to clear the projection pass and the first `setPadding` on a mid-range Android, and
 * short enough that nobody reads it as a stutter: the map is showing the fallback city either way
 * until this lands, and a quarter second of that is well inside the time the sheet and the pins
 * are still settling.
 */
const FIRST_MOVE_DELAY_MS = 250;

/**
 * Point the camera somewhere, and mark the window in which the map's own settle reports are
 * this component's doing rather than the customer's.
 *
 * Takes the refs rather than closing over them so the fit effect can call it without gaining a
 * dependency that changes every render.
 */
function driveCamera(
  map: RefObject<MapView | null>,
  suppressUntil: MutableRefObject<number>,
  from: Region,
  to: Region,
): void {
  /*
   * A JUMP ACROSS THE COUNTRY IS CUT TO — see `LONG_JUMP_DEGREES`. Measured on the larger of the
   * two axes, because either one being that far is enough for the fly-over to be abandoned.
   */
  const jump = Math.max(
    Math.abs(to.latitude - from.latitude),
    Math.abs(to.longitude - from.longitude),
  );
  const duration = jump > LONG_JUMP_DEGREES ? CAMERA_CUT_MS : CAMERA_FLY_MS;

  // Marked BEFORE the call: on a cut the settle report can come back almost immediately.
  suppressUntil.current = Date.now() + duration + SETTLE_SUPPRESSION_TAIL_MS;
  map.current?.animateToRegion(to, duration);
}

export const MapCanvas = forwardRef<MapCanvasHandle, MapCanvasProps>(function MapCanvas(
  {
    initialCentre,
    initialZoom = 'city',
    markers = [],
    frameRoute = true,
    interactive = true,
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

  /**
   * Until when a settle report is this component's own move landing, not the customer panning.
   *
   * See `SETTLE_SUPPRESSION_TAIL_MS` for why the two have to be told apart at all.
   */
  const suppressSettleUntil = useRef(0);

  /** The pickup/drop pair the map was last framed to, so it re-fits once per NEW pair only. */
  const framedTo = useRef<string | null>(null);

  /**
   * This view's own size, so the route can be framed against it — see the fit effect below.
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
      latitudeDelta: ZOOM_DELTA[initialZoom],
      longitudeDelta: ZOOM_DELTA[initialZoom],
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
    driveCamera(map, suppressSettleUntil, region.current, {
      latitude: lat,
      longitude: lng,
      latitudeDelta: delta,
      longitudeDelta: delta,
    });
  };

  useImperativeHandle(ref, () => ({
    moveTo: (lat, lng, zoom) => {
      // Same null-map hazard as `mapPadding` and `fitToCoordinates` — hold it rather than reach
      // into a map that is not there yet.
      if (!mapReady) {
        pendingMove.current = zoom === undefined ? { lat, lng } : { lat, lng, zoom };
        return false;
      }
      /*
       * A LIVE MOVE SUPERSEDES A QUEUED ONE. Both can be in flight at once: the home screen
       * queues the OS's cached fix before the map exists, then asks again with the accurate fix
       * moments later. Without this the flush would fire afterwards and drag the camera back to
       * the stale position — the retry making things worse than no retry at all.
       */
      pendingMove.current = null;
      applyMove(lat, lng, zoom);
      return true;
    },
  }));

  /**
   * The queued first move, flushed a beat AFTER `mapReady` rather than in its commit.
   *
   * **THE DELAY IS THE WHOLE FIX, and it is not defensive padding.** Flushing inline lost the
   * move outright: the app opened on the pilot-city fallback and stayed there, at the fallback's
   * zoom, while the pickup row showed the customer's real coordinates — the map never followed
   * the fix that the rest of the screen had already acted on.
   *
   * Two things collide in that one commit, and both are Android's. `onMapReady` fires when the
   * `GoogleMap` object exists, which is earlier than its first projection pass, and a camera
   * animation issued before that pass is silently dropped. The same commit also applies the first
   * real `mapPadding` (see the prop below), and `GoogleMap.setPadding` moves the camera itself —
   * so even a surviving animation is racing a native camera change aimed somewhere else.
   *
   * Waiting one turn puts the flush after both. It is not a frame (`requestAnimationFrame` is
   * React's paint, not the map's projection) and it is not a guess at how long the map takes —
   * `moveTo` reporting `false` is what covers the case where this is still too early, by leaving
   * the caller free to ask again.
   */
  useEffect(() => {
    if (!mapReady) return;
    if (pendingMove.current === null) return;

    const timer = setTimeout(() => {
      /*
       * RE-READ, never close over the payload taken when the timer was set. A `moveTo` arriving
       * inside this window clears the queue precisely to cancel this flush; a captured copy would
       * ignore that and fly the camera to the superseded point anyway.
       */
      const queued = pendingMove.current;
      pendingMove.current = null;
      if (queued !== null) applyMove(queued.lat, queued.lng, queued.zoom);
    }, FIRST_MOVE_DELAY_MS);
    return () => clearTimeout(timer);
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
    frameRoute && pickup !== undefined && drop !== undefined
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
       * FRAMED BY ARITHMETIC, not by `fitToCoordinates`.
       *
       * THE BUILT-IN FIT CANNOT DO THIS SCREEN. On Android it sets the map's padding from
       * `edgePadding` and then asks Google's bounds solver for a camera. The trip-summary sheet
       * takes 459 of 683dp, so the bottom padding it needs is most of the map — measured on a
       * realme at 3x, a 1556px bottom padding inside a 2049px map. That request is impossible, and
       * Google does not say so: it declines the camera update and leaves the map exactly where it
       * was. No region event follows, which is how this was finally pinned down.
       *
       * The symptom was not a route framed badly. It was a route never framed AT ALL — the map
       * kept whatever view the last move left it on, so the pins sat off the top of the screen and
       * the line ran up out of view. Loosening the padding only traded that for a camera far south
       * of both points at ten times the needed zoom.
       *
       * Computing the region here is arithmetic on numbers this component already holds. It cannot
       * be silently refused, and it states exactly where the two points land: centred in the strip
       * above the sheet.
       */
      const { width, height: viewHeight } = size.current;
      if (viewHeight <= 0 || width <= 0) return;

      /*
       * THE STRIP IS WHAT THE SHEET LEAVES, and the margins are trimmed to fit inside it rather
       * than assumed to fit. See `FRAME_MARGIN_TOP`.
       */
      const visible = Math.max(0, viewHeight - inset);
      const marginTop = Math.min(FRAME_MARGIN_TOP, visible * FRAME_MARGIN_TOP_SHARE);
      const marginBottom = Math.min(FRAME_MARGIN_BOTTOM, visible * FRAME_MARGIN_BOTTOM_SHARE);

      const stripTop = marginTop;
      const stripBottom = Math.max(stripTop, visible - marginBottom);

      const band = Math.max(MIN_FRAME_BAND, stripBottom - stripTop);
      const bandWidth = Math.max(MIN_FRAME_BAND, width - FRAME_MARGIN_SIDE * 2);

      /*
       * A floor on each span, so two points a few metres apart do not ask for an absurd zoom, and
       * a pickup used as its own drop is still a map rather than a division by zero.
       */
      const latSpan = Math.max(Math.abs(p.lat - d.lat), MIN_FRAME_SPAN);
      const lngSpan = Math.max(Math.abs(p.lng - d.lng), MIN_FRAME_SPAN);

      /*
       * A region's deltas describe the WHOLE view, but the points may only use the band — so each
       * span is scaled up by how much smaller its band is than the view containing it.
       */
      const latitudeDelta = latSpan * FRAME_ZOOM_SLACK * (viewHeight / band);
      const longitudeDelta = lngSpan * FRAME_ZOOM_SLACK * (width / bandWidth);

      /*
       * AND THE CAMERA SITS SOUTH OF THE MIDPOINT. A camera centre renders at the centre of the
       * VIEW, while the points must appear at the centre of the BAND, which is higher up. The
       * centre is pushed south by exactly that gap, converted from points to degrees through the
       * delta just computed.
       */
      /*
       * AND IT IS AIMED AT THE MIDDLE OF THE STRIP, not at the middle of the band. The two are the
       * same only while the band fits; once it hits its floor the band is a zoom instruction and
       * nothing more, while the strip's middle stays a fact about the screen. Deriving the aim
       * from the band is what put the route behind the sheet.
       */
      const bandCentreFromTop = (stripTop + stripBottom) / 2;
      const offsetDeg = ((viewHeight / 2 - bandCentreFromTop) / viewHeight) * latitudeDelta;

      driveCamera(map, suppressSettleUntil, region.current, {
        latitude: (p.lat + d.lat) / 2 - offsetDeg,
        longitude: (p.lng + d.lng) / 2,
        latitudeDelta,
        longitudeDelta,
      });
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
        /*
         * ON UNLESS A ROUTE IS BEING FRAMED — those are the only two ways to aim at the visible
         * strip, and running both aims at it twice.
         *
         * WHAT THE PADDING IS FOR: it moves the map's idea of its own centre up out from behind
         * the sheet, so "centre" means the middle of what the customer can SEE. The crosshair
         * needs that — the coordinate reported has to match the spike drawn there — and so does
         * the search screen, where the pickup has to render under the sweep rather than behind
         * the card.
         *
         * WHY THE FRAME CANNOT HAVE IT: the frame reaches the same place by arithmetic, against
         * the view's TRUE centre. Padding then moves where that computed centre renders, the two
         * compensations stack, and the route is pushed up until the far pin is clipped by the top
         * edge — which is exactly what it did. `routeKey` is null whenever no frame is coming,
         * including when a screen has opted out through `frameRoute`, so this follows it.
         */
        mapPadding={
          mapReady && routeKey === null
            ? { top: 0, right: 0, bottom: bottomInset, left: 0 }
            : NO_PADDING
        }
        // Only the SETTLED region is needed — for `onRegionSettled` and for `moveTo` to keep the
        // current span when no zoom is passed. The intermediate `onRegionChange` stream is noise.
        onRegionChangeComplete={(next) => {
          /*
           * THE REMEMBERED REGION IS ALWAYS UPDATED. It is where the camera is, and a `moveTo`
           * with no zoom reads it for the span to keep — lying about it mid-flight would make the
           * next move zoom to wherever the last one was passing through.
           */
          region.current = next;

          /*
           * THE CUSTOMER'S CHOICE IS NOT. Android reports a settle partway through our OWN
           * animations, and the screen treats that report as "they panned here" and re-pins to
           * it. Inside the window the move is ours, so nothing is passed on and the pin stays
           * where it was put. See `SETTLE_SUPPRESSION_TAIL_MS`.
           */
          if (Date.now() < suppressSettleUntil.current) return;
          onRegionSettled?.(next.latitude, next.longitude);
        }}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        // Pan and zoom are the customer's; tilt and rotation are nobody's — a rotated map on a
        // booking screen is only ever an accident.
        scrollEnabled={interactive}
        zoomEnabled={interactive}
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
        // `PIN_TIP_LIFT` raises the stack so the SPIKE, not the stack's middle, is what sits on
        // the map's centre — the coordinate this pin claims to be pointing at.
        <View
          style={[
            styles.centrePin,
            { bottom: bottomInset, transform: [{ translateY: -PIN_TIP_LIFT }] },
          ]}
          pointerEvents="none"
        >
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
    width: CENTRE_PIN_HEAD,
    height: CENTRE_PIN_HEAD,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    borderWidth: 4,
    borderColor: colors.brand,
    marginBottom: -CENTRE_PIN_HEAD_OVERLAP,
  },
  centrePinHeadDrop: { backgroundColor: colors.brand, borderColor: colors.fg },
  centrePinStem: { width: 2, height: CENTRE_PIN_STEM, backgroundColor: colors.fg },
  centrePinShadow: {
    width: 10,
    height: CENTRE_PIN_SHADOW,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
});
