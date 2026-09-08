import * as Crypto from 'expo-crypto';
import { GOOGLE_PLACES_API_KEY } from '@/lib/config';
import { type TripPoint, describeCoordinate } from '@/features/booking/tripPoint';
import { forwardGeocode } from './geocoding';

/**
 * TYPE-AHEAD PLACE SEARCH — the thing the map pin was standing in for.
 *
 * `docs/engineering/tech-choices.md` originally rejected a per-call place API for this app: quote
 * traffic runs ~3× bookings and this screen is the front door, so the device geocoder was chosen
 * and the map pin, not the search box, became the primary way a point gets set. That reasoning was
 * about COST, not correctness — and typing a destination is what a customer actually reaches for
 * first. This adds the good version and keeps the free one underneath.
 *
 * **TWO PROVIDERS, chosen by configuration, never by environment.**
 *
 *   - `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` set → Google Places Autocomplete (New). Real
 *     type-ahead: POIs, landmarks, partial words, ranked by relevance and proximity.
 *   - unset → the device geocoder, exactly as before. One result, whole-string match, no
 *     suggestions worth the name — but free, keyless, offline-capable, and it means this feature
 *     degrades instead of disappearing.
 *
 * The same shape as the API's `GOOGLE_ROUTES_API_KEY` → OSRM fallback in `quotes.container.ts`,
 * and for the same reason: a developer without credentials still gets a working screen.
 *
 * **BILLING.** Autocomplete is charged per SESSION, not per keystroke — but only if the session is
 * closed by a Place Details call carrying the same token. `newSessionToken()` opens one when the
 * customer starts typing and `resolveSuggestion` spends it; a session abandoned without a
 * selection bills as one Autocomplete request. Losing the token would bill every keystroke
 * separately, which is the expensive mistake this API is famous for.
 */

/**
 * Why a lookup came back empty, on `[dz-places]`.
 *
 * A refused key and a genuine no-match both render as "No places match that", which made a whole
 * disabled API look like an unlucky search term — the exact confusion that cost a build cycle
 * here. One line to `adb logcat -s ReactNativeJS:V` tells the two apart. Not gated on `__DEV__`:
 * the release build on a customer's handset is where this is worth having.
 */
function placeLog(event: string, detail?: Record<string, unknown>): void {
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  // eslint-disable-next-line no-console -- a field-diagnosable path with no screen to report on.
  console.log(`[dz-places] ${event}${suffix}`);
}

/** Below this, a query is too short to be worth a request — and too broad to be worth reading. */
export const MIN_QUERY_LENGTH = 3;

/** Results beyond this are noise on a phone-sized list. */
const MAX_SUGGESTIONS = 5;

/** How far around the map centre to prefer results. Wide enough for a city, tight enough to rank. */
const BIAS_RADIUS_M = 30_000;

const AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

/** Whether real type-ahead is available, for copy that should not promise what it cannot do. */
export const hasPlacesProvider = GOOGLE_PLACES_API_KEY.length > 0;

/**
 * One row in the suggestion list.
 *
 * `primary` is the name ("Siliguri Junction"), `secondary` the context ("Siliguri, West Bengal").
 * They are separate because the list renders them differently — one is what the customer is
 * looking for, the other is how they tell two of them apart.
 *
 * `point` is present only for the device-geocoder provider, which resolves coordinates in the same
 * call. Google returns a `placeId` that costs a second request, so that one is deferred to
 * `resolveSuggestion` — see the billing note above.
 */
export interface PlaceSuggestion {
  id: string;
  primary: string;
  secondary: string | null;
  /** Set when the provider already knows the coordinate; otherwise resolve by `id`. */
  point?: TripPoint;
}

/** Opens a billing session. Held by the caller for the life of one search. */
export function newSessionToken(): string {
  return Crypto.randomUUID();
}

/**
 * Suggestions for what the customer has typed.
 *
 * Returns `[]` rather than throwing for every failure — a search box that shows an error banner
 * because a request was aborted mid-keystroke is worse than one that shows nothing. `signal` is
 * how the caller drops a stale query.
 */
export async function suggestPlaces(
  query: string,
  options: {
    near?: { lat: number; lng: number } | undefined;
    sessionToken: string;
    signal?: AbortSignal | undefined;
  },
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];

  if (!hasPlacesProvider) return suggestViaDeviceGeocoder(trimmed);

  try {
    const response = await fetch(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      },
      body: JSON.stringify({
        input: trimmed,
        sessionToken: options.sessionToken,
        // India only. A customer in Siliguri searching "station" should not be offered one in
        // Sialkot, and the region filter is free.
        includedRegionCodes: ['in'],
        ...(options.near === undefined
          ? {}
          : {
              locationBias: {
                circle: {
                  center: { latitude: options.near.lat, longitude: options.near.lng },
                  radius: BIAS_RADIUS_M,
                },
              },
            }),
      }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    if (!response.ok) {
      // The body carries Google's own reason — SERVICE_DISABLED, an API-restriction mismatch, a
      // billing account that lapsed. Far more use than the status alone.
      const reason = await response.text().catch(() => '');
      placeLog('autocomplete refused', { status: response.status, reason: reason.slice(0, 300) });
      return [];
    }

    const body = (await response.json()) as AutocompleteResponse;
    return (body.suggestions ?? [])
      .slice(0, MAX_SUGGESTIONS)
      .map(toSuggestion)
      .filter((entry): entry is PlaceSuggestion => entry !== null);
  } catch (cause) {
    // Aborted (the common one — every keystroke drops the last request), or offline. The caller
    // renders an empty list; the map pin is still there and still works.
    if (!isAbort(cause)) {
      placeLog('autocomplete failed', { message: cause instanceof Error ? cause.message : 'unknown' });
    }
    return [];
  }
}

/**
 * Whether a rejection is just this request being superseded by the next keystroke.
 *
 * React Native does NOT throw a `DOMException` named `AbortError` the way a browser does — its
 * networking layer rejects with a plain `Error` reading "Fetch request has been canceled". Testing
 * for `name === 'AbortError'` alone therefore matched nothing on device, and ordinary typing wrote
 * an `autocomplete failed` line per keystroke: noise in exactly the log a real failure has to be
 * spotted in. Both spellings are checked because the browser one is still correct under Expo web.
 */
function isAbort(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return cause.name === 'AbortError' || /canceled|cancelled|aborted/i.test(cause.message);
}

/**
 * A tapped suggestion → a usable trip point.
 *
 * The device-geocoder provider already carried its coordinate, so this is a no-op for it. For
 * Google it is the Place Details call that both resolves the coordinate AND closes the billing
 * session — passing the same `sessionToken` is what makes the whole search one charge.
 */
export async function resolveSuggestion(
  suggestion: PlaceSuggestion,
  sessionToken: string,
): Promise<TripPoint | null> {
  if (suggestion.point !== undefined) return suggestion.point;
  if (!hasPlacesProvider) return null;

  try {
    const url = `${DETAILS_URL}/${encodeURIComponent(suggestion.id)}?sessionToken=${encodeURIComponent(sessionToken)}`;
    const response = await fetch(url, {
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
        // Field mask is REQUIRED by Places (New) and is also what the call is priced on — asking
        // for the two fields actually used keeps this on the cheapest SKU.
        'X-Goog-FieldMask': 'location,formattedAddress',
      },
    });

    if (!response.ok) {
      const reason = await response.text().catch(() => '');
      placeLog('details refused', { status: response.status, reason: reason.slice(0, 300) });
      return null;
    }

    const body = (await response.json()) as PlaceDetailsResponse;
    const lat = body.location?.latitude;
    const lng = body.location?.longitude;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;

    // The suggestion's own words beat `formattedAddress` when both exist: the customer just read
    // and chose that line, and showing them something different afterwards reads as a mis-tap.
    const address =
      suggestion.secondary === null
        ? suggestion.primary
        : `${suggestion.primary}, ${suggestion.secondary}`;

    return {
      lat,
      lng,
      address:
        address.trim() === ''
          ? (body.formattedAddress ?? describeCoordinate(lat, lng))
          : address,
    };
  } catch (cause) {
    placeLog('details failed', { message: cause instanceof Error ? cause.message : 'unknown' });
    return null;
  }
}

/**
 * The keyless fallback: one whole-string match from the OS geocoder, presented as a
 * single-row "suggestion" so the screen has one code path.
 *
 * Honest about what it is — no POI matching, no partial words, no ranking. It exists so the
 * search box does something before a Places key is configured, not to imitate one.
 */
async function suggestViaDeviceGeocoder(query: string): Promise<PlaceSuggestion[]> {
  const found = await forwardGeocode(query);
  if (found === null) return [];
  return [{ id: `device:${found.lat},${found.lng}`, primary: found.address, secondary: null, point: found }];
}

function toSuggestion(entry: AutocompleteSuggestion): PlaceSuggestion | null {
  const prediction = entry.placePrediction;
  if (prediction === undefined) return null;

  const placeId = prediction.placeId;
  const primary = prediction.structuredFormat?.mainText?.text ?? prediction.text?.text;
  if (placeId === undefined || primary === undefined || primary === '') return null;

  return {
    id: placeId,
    primary,
    secondary: prediction.structuredFormat?.secondaryText?.text ?? null,
  };
}

// ─── Wire shapes ────────────────────────────────────────────────────────────────────────────
// Only the fields actually read. Places (New) returns a great deal more and none of it is needed.

interface AutocompleteResponse {
  suggestions?: AutocompleteSuggestion[];
}

interface AutocompleteSuggestion {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
}

interface PlaceDetailsResponse {
  location?: { latitude?: number; longitude?: number };
  formattedAddress?: string;
}
