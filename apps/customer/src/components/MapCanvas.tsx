import { type ReactElement, forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors, radius } from '@/theme/theme';

/**
 * THE MAP IS A LEAF, AND THIS FILE IS THE ONLY THING THAT KNOWS WHAT DRAWS IT.
 *
 * `docs/engineering/tech-choices.md` records the admin panel's map swap — MapLibre out, Google
 * in — and what made it cheap: *"The map is a LEAF: swapping it touched `ZoneMap.tsx`… Keep it
 * that way."* Same rule here. This file has now been Google's native `react-native-maps` and is
 * currently Leaflet-in-a-WebView, and the screen has not changed for either: every prop below is
 * plain lat/lng, never a map library's own types.
 *
 * **Why not the native Google map.** It renders black in Expo Go: Expo Go's own bundled Maps key
 * is rejected (`Authorization failure … StatusCode=INVALID_ARGUMENT`, confirmed in logcat), and
 * an app cannot supply its own key to a host app it does not build. A development build with an
 * Android-restricted key fixes it and is the intended destination — `app.config.ts` and
 * `apps/customer/.env` already carry that wiring.
 *
 * **What this costs, honestly.** OpenStreetMap's public tile servers are for development, not
 * production: their usage policy forbids heavy or commercial traffic, and attribution is
 * mandatory (rendered by Leaflet, below — do not remove it). Before any real traffic this goes
 * back to the native map, or to a paid tile provider.
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
   * Without this the pin sits at the centre of the SCREEN — which is behind the sheet, invisible
   * — and the coordinate reported back is the one under it rather than the one the customer is
   * looking at. Everything below works in the visible rectangle instead.
   */
  bottomInset?: number;
  /**
   * `| undefined` is not noise: the app compiles with `exactOptionalPropertyTypes`, under which
   * `?: T` refuses an explicitly-passed `undefined`. The screen turns this handler off by
   * passing `undefined` while the map is idle, which is exactly that case.
   */
  onRegionSettled?: ((lat: number, lng: number) => void) | undefined;
}

/** Leaflet zoom levels, not degrees — roughly a few streets, and roughly a whole city. */
const ZOOM: Record<MapZoom, number> = { street: 16, city: 12 };

/** Pinned, not `latest`: a CDN that silently ships a new major would break the map in the field. */
const LEAFLET_VERSION = '1.9.4';

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
  const web = useRef<WebView>(null);

  /**
   * Built ONCE and frozen. Rebuilding the HTML on a prop change would reload the WebView and
   * throw away wherever the customer had panned to — so the document only ever carries the
   * FIRST centre, and every later change is injected as a script call instead.
   */
  const html = useMemo(
    () => buildHtml(initialCentre.lat, initialCentre.lng),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally the first value only
    [],
  );

  function run(script: string): void {
    // The trailing `true;` is required: without a completion value, injectJavaScript warns on iOS.
    web.current?.injectJavaScript(`${script}; true;`);
  }

  useImperativeHandle(ref, () => ({
    moveTo: (lat, lng, zoom) => {
      const level = zoom === undefined ? 'null' : String(ZOOM[zoom]);
      run(`window.dz && window.dz.moveTo(${lat}, ${lng}, ${level})`);
    },
  }));

  // Pushed imperatively rather than rendered, because the document is frozen above.
  // `JSON.stringify` twice — once for the payload, once to embed it as a string literal — is what
  // keeps an apostrophe in an address from ending the script.
  const markersJson = JSON.stringify(markers);
  const userJson = JSON.stringify(userLocation);

  return (
    <View style={styles.root}>
      <WebView
        ref={web}
        style={styles.web}
        source={{ html }}
        originWhitelist={['*']}
        // The page is a fixed-size map, never a scrolling document; leaving scrolling on lets a
        // drag bounce the page instead of panning the map.
        scrollEnabled={false}
        overScrollMode="never"
        bounces={false}
        javaScriptEnabled
        domStorageEnabled
        allowsLinkPreview={false}
        androidLayerType="hardware"
        onMessage={(event) => {
          try {
            const payload: unknown = JSON.parse(event.nativeEvent.data);
            if (
              typeof payload === 'object' &&
              payload !== null &&
              'lat' in payload &&
              'lng' in payload
            ) {
              const { lat, lng } = payload as { lat: number; lng: number };
              onRegionSettled?.(lat, lng);
            }
          } catch {
            // A malformed message is not worth a crash; the map simply does not report a move.
          }
        }}
        onLoadEnd={() => {
          run(
            `window.dz && window.dz.sync(${JSON.stringify(markersJson)}, ${JSON.stringify(userJson)}, ${bottomInset})`,
          );
        }}
      />

      <Sync run={run} markersJson={markersJson} userJson={userJson} bottomInset={bottomInset} />

      {showCentrePin ? (
        // OUTSIDE the WebView, and inset from the bottom by the sheet's height so it lands in the
        // middle of what the customer can actually SEE. The pin stays still and the map moves
        // under it — dragging a marker instead means fighting the pan gesture for the same finger.
        <View style={[styles.centrePin, { bottom: bottomInset }]} pointerEvents="none">
          <View
            style={[
              styles.centrePinHead,
              centrePinKind === 'drop' && styles.centrePinHeadDrop,
            ]}
          />
          <View
            style={[
              styles.centrePinStem,
              centrePinKind === 'drop' && styles.centrePinStemDrop,
            ]}
          />
          <View style={styles.centrePinShadow} />
        </View>
      ) : null}
    </View>
  );
});

/**
 * A render-time bridge. It draws nothing — it exists so the overlay push happens as an ordinary
 * child render rather than in an effect on the parent, which would fire before the WebView has
 * finished loading on a cold start.
 */
function Sync({
  run,
  markersJson,
  userJson,
  bottomInset,
}: {
  run: (script: string) => void;
  markersJson: string;
  userJson: string;
  bottomInset: number;
}): null {
  const last = useRef('');
  const key = `${markersJson}|${userJson}|${bottomInset}`;

  if (last.current !== key) {
    last.current = key;
    run(
      `window.dz && window.dz.sync(${JSON.stringify(markersJson)}, ${JSON.stringify(userJson)}, ${bottomInset})`,
    );
  }

  return null;
}

/**
 * The whole map, as one self-contained document.
 *
 * Leaflet comes from a CDN rather than being bundled: the library is ~150KB and Metro has no way
 * to serve a raw asset into a WebView's own origin without a native file copy. The trade is that
 * a first load needs the network — acceptable for a screen whose tiles need it anyway.
 */
function buildHtml(lat: number, lng: number): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js"></script>
  <style>
    html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; background: ${colors.bgSunken}; }
    /* OpenStreetMap's tile policy REQUIRES visible attribution, and the sheet covers the map's
       bottom edge — the default bottom-right position would hide it. Moved below the top row. */
    .leaflet-control-attribution { font-size: 9px; background: rgba(255,255,255,0.75); }
    .leaflet-top.leaflet-right { margin-top: 76px; }

    /* PICKUP — a live pulse dot, not a static ring. On-brand (ink + yellow) rather than a
       generic green/red map pin, and animated because "this is where you are, right now" is a
       LIVE fact — a still marker undersells it. */
    .dz-pickup-marker-wrap { background: transparent; border: none; }
    .dz-pickup-pin-box {
      position: relative;
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: dz-pin-in 0.22s cubic-bezier(0.34, 1.2, 0.64, 1);
    }
    .dz-pickup-pulse {
      position: absolute;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: ${colors.brand};
      animation: dz-pulse 2s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
    }
    .dz-pickup-core {
      position: relative;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: ${colors.fg};
      border: 2.5px solid ${colors.brand};
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
    @keyframes dz-pulse {
      0% { transform: scale(0.45); opacity: 0.55; }
      70% { opacity: 0; }
      100% { transform: scale(1); opacity: 0; }
    }

    /* DESTINATION — a flat, branded pin (ink body, yellow core) rather than a stock Google-style
       red teardrop with a glossy gradient. Softer entrance too: a quick scale/fade, not a bounce
       — a bounce is a 2015-era Maps mannerism this redesign is moving away from. */
    .dz-drop-marker-wrap { background: transparent; border: none; }
    .dz-drop-pin-box {
      position: relative;
      width: 28px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: dz-pin-in 0.2s cubic-bezier(0.2, 0.8, 0.4, 1);
      transform-origin: bottom center;
    }
    @keyframes dz-pin-in {
      0% { transform: scale(0.5) translateY(-6px); opacity: 0; }
      100% { transform: scale(1) translateY(0); opacity: 1; }
    }
    .dz-pin-ground-shadow {
      position: absolute;
      bottom: 0px;
      left: 50%;
      transform: translateX(-50%);
      width: 12px;
      height: 4px;
      background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0) 72%);
      border-radius: 50%;
    }
    .dz-drop-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 28px;
      height: 34px;
      filter: drop-shadow(0 3px 3px rgba(0,0,0,0.22));
    }

    /* User GPS dot */
    .dz-pin { border-radius: 50%; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.4); }
    .dz-user { background: #1A73E8; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 0 6px rgba(26,115,232,0.20); }

    /* ROUTE — a slim glowing line, not a thick glossy tube. The blur is a real CSS filter on the
       line itself (Leaflet's default renderer is SVG, so a CSS filter just works on the path)
       rather than a second offset copy standing in for a shadow — that offset trick is what read
       as a toy-like 3D pop-up rather than a soft, modern glow. */
    .dz-route-glow { filter: blur(3px); }
    @keyframes dz-flow { to { stroke-dashoffset: -32; } }
    .dz-route-dash { animation: dz-flow 1s linear infinite; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    (function () {
      var map = L.map('map', {
        zoomControl: false,
        attributionControl: true,
        // Smoother panning: inertia carries a flick, and a shorter fade keeps tiles from
        // shimmering in while the map is still moving.
        inertia: true,
        inertiaDeceleration: 2600,
        zoomAnimation: true,
        fadeAnimation: true,
        wheelPxPerZoomLevel: 100
      }).setView([${lat}, ${lng}], ${ZOOM.city});

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        // One ring of tiles beyond the viewport, so a pan reveals map rather than grey.
        keepBuffer: 3,
        updateWhenIdle: false,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);

      map.attributionControl.setPosition('topright');

      // Added in painting order, and it matters: the pickup starts AT the user's position, so a
      // user dot added last sits on top of the marker and hides the point being chosen. The
      // route sits UNDER both — a line is a straight edge in this app, not the road, so it must
      // never look like it is sitting on top of a pin it merely connects.
      var routeLayer = L.layerGroup().addTo(map);
      var userLayer = L.layerGroup().addTo(map);
      var markerLayer = L.layerGroup().addTo(map);

      /** Points of map hidden behind the bottom sheet. Everything below reads it. */
      var inset = 0;

      /**
       * The last pickup/drop pair the map was fitted to, so it re-fits exactly once per NEW pair
       * rather than on every sync() call — which also fires when only the sheet's height changes
       * (bottomInset) as rows like Return appear or disappear. Re-zooming on that would fight
       * a customer who has since panned or pinched to look at something else on their own trip.
       */
      var lastRoute = null;

      function post(payload) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(payload));
        }
      }

      /**
       * The coordinate under the PIN, not under the centre of the map.
       *
       * The sheet covers the lower part of the map, so the geometric centre is behind it. The
       * pin sits at the middle of the visible strip, and this is the same point in map terms —
       * getting this wrong means the address shown never matches where the pin is.
       */
      function visibleCentre() {
        var size = map.getSize();
        return map.containerPointToLatLng(L.point(size.x / 2, (size.y - inset) / 2));
      }

      // 'moveend' covers pan AND zoom, and fires once the movement has settled.
      map.on('moveend', function () {
        var c = visibleCentre();
        post({ lat: c.lat, lng: c.lng });
      });

      function icon(kind) {
        if (kind === 'drop') {
          // A flat, branded pin — ink body, a yellow ring and core, a single white hairline
          // stroke for contrast against any tile colour. No gradient: gradients on a small glyph
          // read as glossy/dated at this size, and this app's brand yellow is used as a flat
          // surface everywhere else in the app, never as a gradient fill.
          return L.divIcon({
            className: 'dz-drop-marker-wrap',
            html: '<div class="dz-drop-pin-box">' +
              '<div class="dz-pin-ground-shadow"></div>' +
              '<svg class="dz-drop-svg" viewBox="0 0 28 34" width="28" height="34" fill="none">' +
              '  <path d="M14 33 C13.3 30.4 3 19.7 3 13 A11 11 0 1 1 25 13 C25 19.7 14.7 30.4 14 33 Z" fill="${colors.fg}" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round"/>' +
              '  <circle cx="14" cy="13" r="5" fill="${colors.brand}"/>' +
              '</svg>' +
              '</div>',
            iconSize: [28, 38],
            iconAnchor: [14, 35]
          });
        }

        if (kind === 'pickup') {
          // A pulsing dot rather than a static ring — pickup is a LIVE fact, and the animation is
          // what says so. The pulse ring shares the pin box's own centre, so it never drifts off
          // the coordinate the way an independently-positioned glow layer could.
          return L.divIcon({
            className: 'dz-pickup-marker-wrap',
            html: '<div class="dz-pickup-pin-box">' +
              '<div class="dz-pickup-pulse"></div>' +
              '<div class="dz-pickup-core"></div>' +
              '</div>',
            iconSize: [34, 34],
            iconAnchor: [17, 17]
          });
        }

        var size = 14;
        return L.divIcon({
          className: '',
          html: '<div class="dz-pin dz-user" style="width:' + size + 'px;height:' + size + 'px"></div>',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2]
        });
      }

      function getCurvedPath(p1, p2) {
        var lat1 = p1.lat, lng1 = p1.lng;
        var lat2 = p2.lat, lng2 = p2.lng;

        var midLat = (lat1 + lat2) / 2;
        var midLng = (lng1 + lng2) / 2;

        var cosLat = Math.cos(midLat * Math.PI / 180);
        var dx = (lng2 - lng1) * cosLat;
        var dy = lat2 - lat1;
        var dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 0.00001) {
          return [[lat1, lng1], [lat2, lng2]];
        }

        var nx = -dy / dist;
        var ny = dx / dist;

        if (ny < -0.05 || (Math.abs(ny) <= 0.05 && nx < 0)) {
          nx = -nx;
          ny = -ny;
        }

        // A softer bulge than before (was 0.22) — enough to read as a deliberate curve rather
        // than a straight line, subtle enough not to look like an exaggerated cartoon arc.
        var arcHeight = dist * 0.14;
        var ctrlLat = midLat + (ny * arcHeight);
        var ctrlLng = midLng + ((nx * arcHeight) / cosLat);

        var points = [];
        var steps = 45;
        for (var i = 0; i <= steps; i++) {
          var t = i / steps;
          var oneMinusT = 1 - t;
          var b0 = oneMinusT * oneMinusT;
          var b1 = 2 * oneMinusT * t;
          var b2 = t * t;

          var lat = b0 * lat1 + b1 * ctrlLat + b2 * lat2;
          var lng = b0 * lng1 + b1 * ctrlLng + b2 * lng2;
          points.push([lat, lng]);
        }
        return points;
      }

      window.dz = {
        moveTo: function (lat, lng, zoom) {
          var z = zoom === null ? map.getZoom() : zoom;
          // Offset the CENTRE so the target lands under the pin rather than behind the sheet.
          var target = map.project([lat, lng], z);
          var centre = map.unproject(target.add([0, inset / 2]), z);
          map.flyTo(centre, z, { duration: 0.6, easeLinearity: 0.2 });
        },
        sync: function (markersJson, userJson, nextInset) {
          var markers = JSON.parse(markersJson) || [];
          var user = JSON.parse(userJson);
          inset = nextInset || 0;

          markerLayer.clearLayers();
          markers.forEach(function (m) {
            L.marker([m.lat, m.lng], { icon: icon(m.kind), title: m.title }).addTo(markerLayer);
          });

          userLayer.clearLayers();
          if (user) {
            L.marker([user.lat, user.lng], { icon: icon('user'), interactive: false }).addTo(userLayer);
          }

          // THE ROUTE, drawn as a slim glowing line — not the thick glossy tube this replaced.
          // Three layers, each doing one job: a soft blurred glow for lift, a slim solid line
          // for the actual path, and a thin animated dash on top for direction. No offset
          // "shadow copy" of the path — that was what made the old version look like a raised
          // toy tube rather than a modern line with a soft shadow under it.
          routeLayer.clearLayers();
          var pickup = markers.filter(function (m) { return m.kind === 'pickup'; })[0];
          var drop = markers.filter(function (m) { return m.kind === 'drop'; })[0];
          if (pickup && drop) {
            var curvedPath = getCurvedPath(pickup, drop);

            // 1. Soft glow — a wide, low-opacity, blurred stroke sitting under everything. This
            // is the depth cue; a real CSS blur reads as a soft shadow, not a hard duplicate line.
            L.polyline(curvedPath, {
              color: '${colors.fg}',
              weight: 9,
              opacity: 0.16,
              lineCap: 'round',
              interactive: false,
              className: 'dz-route-glow'
            }).addTo(routeLayer);

            // 2. The line itself — slim, ink-coloured, rounded caps. This alone reads as "modern
            // minimal route" without any casing or tube layering.
            L.polyline(curvedPath, {
              color: '${colors.fg}',
              weight: 3,
              opacity: 0.92,
              lineCap: 'round',
              interactive: false
            }).addTo(routeLayer);

            // 3. The animated accent — brand yellow, thin, marching toward the destination. The
            // one piece of colour on the whole line, and the one thing that moves.
            L.polyline(curvedPath, {
              color: '${colors.brand}',
              weight: 3,
              opacity: 0.95,
              dashArray: '2, 12',
              lineCap: 'round',
              interactive: false,
              className: 'dz-route-dash'
            }).addTo(routeLayer);

            // Fit map bounds to frame both pins and the full apex of the curve
            var routeKey = pickup.lat + ',' + pickup.lng + '|' + drop.lat + ',' + drop.lng;
            if (routeKey !== lastRoute) {
              lastRoute = routeKey;
              var bounds = L.latLngBounds(curvedPath);
              map.fitBounds(bounds, {
                paddingTopLeft: [40, 80],
                paddingBottomRight: [40, inset + 40],
                maxZoom: 16,
                animate: true,
                duration: 0.6
              });
            }
          } else {
            lastRoute = null;
          }
        }
      };

      post({ ready: true });
    })();
  </script>
</body>
</html>`;
}

const styles = StyleSheet.create({
  // Written out rather than `StyleSheet.absoluteFillObject`, which React Native 0.86's types no
  // longer expose (`absoluteFill` is a registered style ID, not a spreadable object).
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  web: { flex: 1, backgroundColor: colors.bgSunken },

  centrePin: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The head sits half its own height above centre so the stem's TIP marks the coordinate,
  // which is the point the customer is actually choosing.
  centrePinHead: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    borderWidth: 4,
    borderColor: colors.brand,
    marginBottom: -2,
  },
  // Inverted, not recoloured to red — pickup is ink-with-yellow-border, drop is the same two
  // brand colours the other way round. Distinguishable at a glance without reaching for a
  // generic red/green that has nothing to do with this app's own palette.
  centrePinHeadDrop: {
    backgroundColor: colors.brand,
    borderColor: colors.fg,
    borderWidth: 4,
  },
  centrePinStem: { width: 2, height: 16, backgroundColor: colors.fg },
  centrePinStemDrop: { backgroundColor: colors.fg },
  centrePinShadow: {
    width: 10,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
});
