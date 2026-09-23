import { Feather } from '@expo/vector-icons';
import { DateTimeChooser } from '@/components/DateTimeChooser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  LinearTransition,
} from 'react-native-reanimated';
import type { AddressLabel, Direction, SavedAddressDto } from '@driverzone/contracts';
import { Logo } from '@/components/Logo';
import { BottomSheet } from '@/components/BottomSheet';
import { DraggableSheet } from '@/components/DraggableSheet';
import { GlassPanel } from '@/components/GlassPanel';
import { MapCanvas, type MapCanvasHandle, type MapMarker } from '@/components/MapCanvas';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SavedPlaceRow } from '@/components/SavedPlaceRow';
import { TripPointRow } from '@/components/TripPointRow';
import { TripSummaryCard } from '@/components/TripSummaryCard';
import { type CoverageState, coverageCopy, toCoverageState } from '@/features/booking/coverage';
import {
  type TripPoint,
  describeCoordinate,
  fromSavedAddress,
  samePoint,
} from '@/features/booking/tripPoint';
import { FareSheet } from '@/components/FareSheet';
import { TripOptions } from '@/components/TripOptions';
import { unavailableTitle } from '@/features/booking/quote';
import { REBOOK_PARAM_KEYS, parseRebookParams } from '@/features/booking/rebook';
import {
  allowsInstant,
  defaultScheduleAnchor,
  returnProblem,
  scheduleBounds,
  scheduleProblem,
} from '@/features/booking/schedule';
import { useTripQuote } from '@/features/booking/useTripQuote';
import { forwardGeocode, reverseGeocode } from '@/features/location/geocoding';
import { type PlaceSuggestion, hasPlacesProvider } from '@/features/location/placeSearch';
import { usePlaceSuggestions } from '@/features/location/usePlaceSuggestions';
import { useCurrentLocation } from '@/features/location/useCurrentLocation';
import { checkCoverage } from '@/lib/api/endpoints/coverage';
import { addAddress, getProfile, removeAddress } from '@/lib/api/endpoints/customer';
import { getCurrentBooking } from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

/**
 * The signed-in home screen: a map, a pickup, a destination, and an honest answer about whether
 * we serve the pickup.
 *
 * The layout follows the convention every ride-hailing app shares — map behind, a sheet in
 * front, the DESTINATION as the one prominent field, saved places one tap below it. That is not
 * imitation for its own sake: a customer arriving here has used Rapido or Uber this week, and a
 * home screen that puts its controls somewhere else makes them hunt for no gain.
 *
 * **It asks TWO questions before Continue lights up**, because they have different answers.
 * `/coverage/check` says whether we come to this pickup point at all. `POST /quotes` — via
 * `useTripQuote` — says whether we sell anything for this particular trip, which is the only
 * place "no package covers this distance" can come from. Both can stop the flow, each renders
 * its own line above the button, and the button is disabled while either is unresolved.
 *
 * **Continue opens a sheet, it does not navigate.** The fare card is the last question this
 * screen asks, so it rises over the map with the trip still behind it — changing a pin is a
 * dismiss rather than a back navigation and a remount. It also means one component holds the
 * quote, the pins and the trip terms together, instead of serialising them through route params.
 *
 * This screen also does NOT decide incity versus outstation: docs/LLD/api-contracts.md makes
 * that a server decision — the quote response carries `service_type` and the `DROP_OUTSIDE_CITY`
 * suggestion — and an app that guessed would be a second pricing brain to keep in step.
 */

/**
 * Exactly one mode is live at a time, and the map's behaviour follows from it: in `idle` the map
 * shows the chosen points, in either picking mode it carries a fixed centre pin and reports
 * wherever it settles. Two independent booleans would allow "picking both", which is meaningless.
 */
type Mode = 'idle' | 'pick-pickup' | 'pick-drop';

/** Long enough that a pan does not fire a geocode per frame, short enough to feel immediate. */
const GEOCODE_DEBOUNCE_MS = 450;

/**
 * How much of the PICKING sheet survives a collapse: the title and the pinned address.
 *
 * Enough to keep the customer oriented while they move the map — which is the whole reason to
 * collapse it — without leaving so much sheet that the map is still hidden.
 */
const PICK_PEEK = 230;

/**
 * The home sheet's SMALL detent — its lower rest position. Enough for the grabber, the pickup
 * row and the destination box; the saved list and Continue slide under. LARGE (all of it) is
 * the default — see `DraggableSheet`.
 */
const HOME_PEEK = 264;

/**
 * How much uncovered map there has to be before the recentre button is worth showing.
 *
 * Sized from what it has to clear, not picked for feel: the header row is `top: space.md` plus a
 * 44pt glass button, the recentre circle is another 44 plus its own `space.md` gap, and a strip of
 * map between the two is what stops them reading as one stack. Below this the button would be
 * sitting on the account button — and there would be almost no map left to recentre anyway.
 */
const RECENTRE_MIN_MAP = 190;

const SAVE_LABELS: ReadonlyArray<{ value: AddressLabel; title: string }> = [
  { value: 'HOME', title: 'Home' },
  { value: 'OFFICE', title: 'Office' },
  { value: 'OTHER', title: 'Other' },
];

export default function HomeScreen(): ReactElement {
  const location = useCurrentLocation();
  const queryClient = useQueryClient();
  const map = useRef<MapCanvasHandle>(null);

  const [mode, setMode] = useState<Mode>('idle');
  const [pickup, setPickup] = useState<TripPoint | null>(null);
  const [drop, setDrop] = useState<TripPoint | null>(null);

  // The point under the centre pin, and the words for it. Separate from `pickup`/`drop` because
  // nothing is chosen until Confirm — panning past somewhere must not select it.
  const [draft, setDraft] = useState<{ lat: number; lng: number } | null>(null);
  const [draftAddress, setDraftAddress] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const [search, setSearch] = useState('');
  const [searchMissed, setSearchMissed] = useState(false);
  const [searching, setSearching] = useState(false);
  /**
   * Whether the suggestion list is showing.
   *
   * Separate from "there are suggestions", because a chosen place must leave its own name in the
   * field without immediately re-opening the list underneath it. Typing opens it; choosing,
   * clearing, or leaving the picker closes it.
   */
  const [suggestOpen, setSuggestOpen] = useState(false);

  /**
   * Type-ahead for the search field, biased to whatever the map is currently looking at — the pin
   * while picking, otherwise the pickup, otherwise the device. "Station" means the one nearby.
   *
   * Debouncing, stale-response ordering and the billing session all live in the hook; this screen
   * only decides when to show the rows and what a tap does with one.
   *
   * The query is gated on `suggestOpen` rather than only the rendering, so a CLOSED list issues no
   * requests at all. Without that, writing the chosen place's name back into the field — which
   * `chooseSuggestion` does — would immediately schedule a lookup for it: a paid request for a
   * place already chosen, whose results nobody would ever see.
   */
  const places = usePlaceSuggestions(suggestOpen ? search : '', draft ?? pickup ?? location.point);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  /**
   * How much map the sheet covers, so the centre pin and the reported coordinate both land in
   * the VISIBLE middle. Measured rather than assumed: both sheets change height with content,
   * and a collapsed sheet covers only its peek.
   */
  const [sheetHeight, setSheetHeight] = useState(0);
  /**
   * The strip of map left above whatever sheet is showing — what decides whether the recentre
   * button has anywhere to sit. See `RECENTRE_MIN_MAP`.
   */
  const { height: windowHeight } = useWindowDimensions();
  const mapRoomAbove = windowHeight - sheetHeight;
  /**
   * Within a picking mode: is the customer placing the pin themselves?
   *
   * A sub-state rather than a third `Mode`, because it does not change WHAT is being chosen —
   * only how. Every exit from picking clears it, so the picker always opens on the list.
   */
  const [mapPick, setMapPick] = useState(false);

  /**
   * THE TRIP'S TERMS, owned here rather than on the fare screen, because they are chosen before a
   * price is asked for and every one of them changes what that price is. They travel forward as
   * route params so the fare screen quotes the same trip and reads the same cache entry.
   *
   * `ROUND_TRIP` is the default because it is the trip most outstation customers are actually
   * taking — they were selecting it by hand on nearly every booking. It is NOT the server's
   * default (absence still means `ONE_WAY`), so an untouched outstation trip now sends `direction`
   * explicitly; `useTripQuote` handles that. Incity has no return to sell, and the effect below
   * puts those trips back to `ONE_WAY` as soon as the service type is known.
   */
  const [direction, setDirection] = useState<Direction>('ROUND_TRIP');
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  /** Local only — nothing on the wire carries a return time. See `RETURN_IS_LOCAL_ONLY`. */
  const [returnAt, setReturnAt] = useState<Date | null>(null);
  /** Which picker is open, if any. One at a time: they write to different fields. */
  const [timePicker, setTimePicker] = useState<'schedule' | 'return' | null>(null);
  /** The fare sheet. Opened by Continue, and the last step this screen owns. */
  const [fareOpen, setFareOpen] = useState(false);

  /**
   * True while the pickup is still the device's own position rather than something the customer
   * chose. A later, more accurate fix may overwrite an automatic pickup; it must never overwrite
   * one they set by hand.
   */
  const pickupIsAutomatic = useRef(true);
  /**
   * The map follows the first real fix only. After that it is the customer's to move.
   *
   * **IT LATCHES ON THE MOVE LANDING, NOT ON US ASKING FOR IT**, and that distinction is the
   * whole of a bug this screen shipped with. `useCurrentLocation` answers twice on purpose — the
   * OS's cached fix almost immediately, the accurate one seconds later — and the cached one
   * routinely beats the native map into existence. `moveTo` then queues rather than moving, and
   * latching there spent the single recentre on a move that had not happened yet. When Android
   * dropped the queued flush, nothing ever asked again: the map sat on the pilot-city fallback
   * for the whole session while the Pickup row above it showed the customer's real address.
   *
   * So the latch closes only on a `true`, and the accurate fix that follows becomes a free second
   * attempt. The cost of the retry is that a customer who is genuinely moving may see the camera
   * refine once more; that is the correct picture, and it is bounded at one.
   */
  const hasCentred = useRef(false);

  useEffect(() => {
    if (!location.isReal) return;

    if (pickupIsAutomatic.current) setPickup(location.point);

    if (!hasCentred.current) {
      const moved = map.current?.moveTo(location.point.lat, location.point.lng, 'street') ?? false;
      if (moved) hasCentred.current = true;
    }
  }, [location.isReal, location.point]);

  /**
   * BOOK AGAIN — this screen was opened from a past trip, carrying its two ends.
   *
   * APPLIED ONCE PER REQUEST, then the params are cleared. Home is a TAB: it stays mounted, and
   * without both halves of that a customer who rebooks, moves the pin, then switches to Rides and
   * back would find their edit silently reverted to the old trip. `appliedRebook` guards the
   * re-renders, `setParams` guards the tab switches.
   *
   * IT ALSO SETTLES THE RACE WITH THE GPS. `pickupIsAutomatic` is what tells the effect above
   * that a later, better fix may overwrite the pickup — a rebooked pickup is a choice, so this
   * closes that door before the fix arrives rather than after.
   *
   * NO TIME IS RESTORED, and what that leaves behind now depends on the product. The old trip's
   * pickup instant is in the past either way. An in-city rebook simply leaves NOW, which is what
   * "book that again" usually means; an outstation one stays blocked until the customer names a
   * new time. See `rebook.ts` on what else is left behind.
   */
  const rebookParams = useLocalSearchParams<Record<string, string>>();
  const appliedRebook = useRef<string | null>(null);

  useEffect(() => {
    const rebook = parseRebookParams(rebookParams);

    /*
     * No params — either an ordinary visit, or the clear below has landed. Releasing the guard
     * here is what lets the SAME past trip be rebooked twice: tap it, edit the destination, come
     * back, tap it again. Holding the token forever would make that second tap do nothing, which
     * reads as the button being broken.
     */
    if (rebook === null) {
      appliedRebook.current = null;
      return;
    }

    if (appliedRebook.current === rebook.token) return;

    appliedRebook.current = rebook.token;

    pickupIsAutomatic.current = false;
    setPickup(rebook.pickup);
    setDrop(rebook.drop);

    // The map goes to the PICKUP rather than trying to frame both: `MapCanvas` recentres, it does
    // not fit a bounding box, and the pickup is the end the customer is standing at.
    hasCentred.current = true;
    map.current?.moveTo(rebook.pickup.lat, rebook.pickup.lng, 'street');

    // Anything mid-pick is abandoned — the trip just changed underneath it.
    setMode('idle');
    setDraft(null);
    setDraftAddress(null);

    router.setParams(Object.fromEntries(REBOOK_PARAM_KEYS.map((key) => [key, ''])));
  }, [rebookParams]);

  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

  /**
   * THE BOOKING RECOVERY READ.
   *
   * Android kills a backgrounded app whenever it wants memory, and the booking id lived only in
   * navigation state. Reopening landed here — the booking map — with a driver already on the way
   * and no route back to the trip: the Rides tab reaches `app/rides/[id].tsx`, which is a
   * receipt with no live status, no cancel bar and, worst of all, no `start_otp`. A customer
   * whose app restarted at the pickup could not get to the four digits their driver was standing
   * there waiting for.
   *
   * THE ANSWER IS THE RESUME BANNER, not a redirect. This read is what makes the banner possible;
   * the banner is what makes the trip reachable. Restoring an automatic navigation here would fix
   * nothing this does not already fix, and would take the screen away from a customer who opened
   * the app to do something else.
   */
  const activeBooking = useQuery({
    queryKey: keys.bookings.current(),
    queryFn: ({ signal }) => getCurrentBooking(signal),
  });

  const live = activeBooking.data?.booking ?? null;

  /*
   * NOTHING NAVIGATES AUTOMATICALLY. A live booking is announced by the banner below and reached
   * by tapping it — never by moving the customer somewhere they did not ask to go.
   *
   * There used to be a launch-time redirect here, fired once per app launch. Even once is once too
   * many: a customer opening the app to book a second car, check a fare, or look at the map got
   * thrown onto the trip screen before they could touch anything, and the only way back was the
   * back gesture. An app that overrides where you were heading feels broken even when the
   * destination is somewhere you would have chosen.
   *
   * `apps/driver` never did this — its home screen has only the equivalent banner — so removing it
   * also settles a difference between the two apps that had no reason to exist.
   */

  /*
   * Re-read whenever Home regains focus, so a trip that ended elsewhere stops offering to be
   * resumed. Without this the banner would outlive the booking it points at.
   */
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: keys.bookings.current() });
    }, [queryClient]),
  );

  /**
   * Coordinates are rounded into the KEY, not just the request: a float that differs in its
   * fifteenth decimal is the same street corner, and an unrounded key would miss the cache and
   * re-ask on every render that recreates the point.
   */
  const coverage = useQuery({
    queryKey: keys.coverage.check(round(pickup?.lat ?? 0), round(pickup?.lng ?? 0)),
    queryFn: () => {
      if (pickup === null) return Promise.reject(new Error('No pickup point set.'));
      return checkCoverage({ lat: pickup.lat, lng: pickup.lng });
    },
    enabled: pickup !== null,
  });

  const coverageState: CoverageState =
    pickup === null
      ? { kind: 'idle' }
      : coverage.isError
        ? { kind: 'failed' }
        : coverage.data === undefined
          ? { kind: 'checking' }
          : toCoverageState(coverage.data);

  /**
   * `served` and `servedFree` are the only two coverage states that let us go on and ask for a
   * price; `checking` and `failed` are both "we do not know yet", and quoting on a pickup we
   * could not verify is how a paid pickup zone surprises somebody.
   */
  const servedHere = coverageState.kind === 'served' || coverageState.kind === 'servedFree';

  /**
   * THE SECOND QUESTION, AND COVERAGE CANNOT ANSWER IT.
   *
   * `/coverage/check` resolves zones. Whether a PACKAGE exists for this particular trip — the
   * distance band, the direction, the terrain — is decided by `packages.resolveForTrip` and is
   * only ever reported through `POST /quotes`. So "no package covers this distance" is
   * unknowable here without asking for the price, and asking here is the only way Continue can
   * be blocked before the customer presses it rather than after.
   *
   * The cost of asking early is real and worth naming: setting a destination now spends a quote,
   * and quoting is rate limited to 30/min per customer. It is bounded by `enabled` — no request
   * until both points exist AND coverage came back served — and the answer is not thrown away:
   * the fare screen reads this very cache entry under the same key, so pressing Continue costs
   * no second round trip and shows the price on its first frame.
   */
  /**
   * QUOTED AS SOON AS THERE ARE TWO POINTS AND A PICKUP WE SERVE — no pickup time required.
   *
   * This screen used to wait for a time, on the reasoning that the instant decides which surcharge
   * window the trip falls in and a price fetched before one is chosen prices a different trip.
   * That reasoning survives for outstation and is now circular for in-city: an in-city trip may
   * leave NOW, but "is this in-city?" is the server's verdict and arrives only WITH a quote. Wait
   * for a time before asking, and the app can never learn that this particular trip never needed
   * one. So it asks first, with no time, which `useTripQuote` sends as an absent field and the
   * server reads as "now" off its own clock.
   *
   * The price stays honest either way: choosing a time afterwards re-keys the query and re-quotes,
   * because the instant is part of the cache key. What a customer is shown is always the price of
   * the trip as currently described.
   *
   * THE COST IS ONE QUOTE, and it is worth naming. A customer who sets a destination and then
   * abandons the screen now spends a row against the 30/min limit that they previously would not
   * have. It buys the "no package" verdict and the service type before Continue is pressed, which
   * is what every branch below reads.
   */
  const trip = useTripQuote(
    pickup,
    drop,
    servedHere,
    direction,
    scheduledAt,
    // The return leg is part of the price now — the band fare multiplies by the days it spans.
    returnAt,
  );

  /**
   * What the server said this trip is — `null` until it has said anything, which is a state the
   * options block renders differently rather than hiding through.
   *
   * `stale` is not consulted on purpose: while a re-quote is in flight the PREVIOUS trip's service
   * type is a far better guess than "unknown", and flipping the direction control out and back on
   * every destination change would be the more distracting of the two wrongs.
   */
  const serviceType = trip.card?.service_type ?? null;

  /**
   * A round trip on an incity trip is not a thing that exists, and the server ignores `direction`
   * there — so a customer who chose it before the answer arrived would otherwise keep a Return row
   * on screen for a product with no return, quietly keyed into their quote.
   */
  useEffect(() => {
    if (serviceType === 'INCITY' && direction === 'ROUND_TRIP') {
      setDirection('ONE_WAY');
      setReturnAt(null);
    }
  }, [serviceType, direction]);

  /**
   * Continue needs both points, a pickup we serve, AND a fare that exists.
   *
   * A FAILED quote does NOT block. An unavailable answer is the server saying "there is nothing
   * to sell you here", which is final and worth stopping for; a network failure is the app not
   * knowing, and the fare screen has a real retry for it. Blocking on "we could not ask" would
   * strand a customer on a lift ride with no way forward and nothing to press.
   */
  /**
   * `stale` guards both of these. The hook keeps the previous answer on screen while a new one
   * loads — which the fare screen's direction toggle needs — so without this check, changing the
   * destination would flash the OLD destination's "no package" verdict over the new one for as
   * long as the request takes.
   */
  const noPackage = trip.unavailable !== null && !trip.stale;
  const pricing = trip.query.isFetching;
  /**
   * The app's OWN rules about its own pickers — a pickup at least an hour out, a return after the
   * pickup — as opposed to every other clause here, which is the server's verdict. Each renders
   * on the offending row itself, so the button still needs no explanation of its own.
   */
  const timesInvalid =
    scheduleProblem(scheduledAt, serviceType) !== null ||
    returnProblem(returnAt, scheduledAt) !== null;

  /**
   * WHETHER THIS TRIP CAN LEAVE NOW — the one branch the instant-booking rule turns on.
   *
   * In-city only, and optimistically true while the quote is still in flight; `allowsInstant`
   * carries the reasoning. When it holds, an empty pickup time is the value "now" rather than an
   * unanswered question, so it drops out of `tripIncomplete` and out of the notice below.
   */
  const instant = allowsInstant(serviceType);

  /**
   * EVERY FIELD THE TRIP NEEDS, in one place — a destination, a pickup time unless the trip can
   * leave now, and a return time when the customer asked for a round trip. An in-city trip with no
   * time is COMPLETE, not incomplete: the absent field is the value "now", and requiring an
   * answer there is the hour's wait this change exists to remove.
   *
   * An unset field is not an ERROR and gets no red line:
   * the row it belongs to says "Select a time" or "Not set" in muted type, which is an instruction
   * rather than a complaint about something they have not done yet. Red is reserved for a choice
   * that was made and cannot be used.
   *
   * The pickup point is in the list even though the device usually supplies it — permission can be
   * refused, and a trip with no origin must not reach a fare.
   */
  const tripIncomplete =
    pickup === null ||
    drop === null ||
    (scheduledAt === null && !instant) ||
    (direction === 'ROUND_TRIP' && returnAt === null);

  const canContinue = !tripIncomplete && servedHere && !noPackage && !pricing && !timesInvalid;

  /**
   * The one incomplete field customers do not spot on their own.
   *
   * `tripIncomplete` above treats a missing time as an ordinary unset field, and the Pickup row
   * says "Select a time" in muted type. That reads as an instruction only if you are looking at
   * the row — and customers were not. They had picked both points, watched Continue stay dead,
   * and had no idea the row above it was a question rather than a label. A disabled button with
   * no stated reason is indistinguishable from a broken one.
   *
   * So this names the missing field, and ONLY when it is the last thing standing in the way:
   * both points chosen, an area we serve, a package that exists. Raised before a destination is
   * even set it would be noise on the screen's ordinary starting state, and would be showing
   * every customer a warning about a step they had not reached yet.
   *
   * `tone_warn`, not `tone_bad` — nothing has gone wrong and nothing was rejected. A red line
   * here would be the screen complaining about something the customer has not done yet, which
   * is the distinction the notice tones exist to hold.
   */
  const missingTimeOnly =
    pickup !== null &&
    drop !== null &&
    servedHere &&
    !noPackage &&
    !timesInvalid &&
    ((scheduledAt === null && !instant) || (direction === 'ROUND_TRIP' && returnAt === null));

  /**
   * The two points travel as ROUTE PARAMS rather than in a store, because they are the entire
   * input to the fare screen and expo-router persists them across a remount for free. A
   * module-scoped "current trip" object would be a second source of truth for the same two
   * coordinates, and the copy that goes stale is always the one not in the URL.
   */
  /**
   * Continue opens the fare SHEET, over this screen — it does not navigate.
   *
   * Choosing a duration is the last question this screen asks, not a departure from it, and the
   * map staying behind the sheet is what makes changing a pin a dismiss rather than a back
   * navigation and a remount. It also keeps the quote, the pins and the trip options in one
   * component's state: nothing is serialised into route params and parsed back, which was the
   * only reason the terms ever needed a wire format between screens.
   */
  const openFareCard = useCallback(() => {
    if (pickup === null || drop === null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFareOpen(true);
  }, [pickup, drop]);

  /**
   * Saving a place is a real write to `POST /customer/addresses`, and the saved list lives on the
   * PROFILE (`CustomerProfileDto.saved_addresses`) rather than in its own endpoint — so the
   * profile query is what gets invalidated, and the new place appears in the list below without
   * this screen holding a second copy of it.
   */
  const saveAddress = useMutation({
    mutationFn: (label: AddressLabel) => {
      const point = draft === null ? null : { ...draft, address: draftAddress };
      if (point === null) return Promise.reject(new Error('No place to save.'));
      return addAddress({
        label,
        address: point.address ?? describeCoordinate(point.lat, point.lng),
        lat: point.lat,
        lng: point.lng,
      });
    },
    onSuccess: async (saved) => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSaveOpen(false);
      setSavedNotice(`Saved to ${saved.label === 'OFFICE' ? 'Office' : titleCase(saved.label)}`);
      await queryClient.invalidateQueries({ queryKey: keys.profile.all() });
    },
    onError: (cause) => {
      setSaveOpen(false);
      // The server's wording, verbatim — a duplicate label or a bad coordinate is its call.
      setSavedNotice(cause instanceof Error ? cause.message : 'Could not save this place.');
    },
  });

  const forgetAddress = useMutation({
    mutationFn: (saved: SavedAddressDto) => removeAddress(saved.id),
    onSuccess: async () => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSavedNotice('Removed from saved places');
      await queryClient.invalidateQueries({ queryKey: keys.profile.all() });
    },
    onError: (cause) => {
      setSavedNotice(cause instanceof Error ? cause.message : 'Could not remove this place.');
    },
  });

  // A saved-place confirmation is transient by nature: it reports something that already
  // happened, and leaving it on screen turns it into a permanent label.
  useEffect(() => {
    if (savedNotice === null) return;
    const timer = setTimeout(() => setSavedNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [savedNotice]);

  // Reverse-geocode wherever the map settled, once it has stopped moving.
  useEffect(() => {
    if (mode === 'idle' || draft === null) return;

    let cancelled = false;
    setResolving(true);

    const timer = setTimeout(() => {
      void (async () => {
        const address = await reverseGeocode(draft.lat, draft.lng);
        // The pin has moved on, or the customer left the mode. Writing now would label the new
        // position with the old place's name.
        if (cancelled) return;
        setDraftAddress(address);
        setResolving(false);
      })();
    }, GEOCODE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft, mode]);

  /**
   * The customer panned the map — the pin is over somewhere new.
   *
   * ONLY GENUINE PANS REACH THIS. `MapCanvas` withholds the region reports that come from its own
   * `moveTo`, because those fire mid-animation and would overwrite a chosen place with a point the
   * camera was flying over. See `SETTLE_SUPPRESSION_TAIL_MS` there, and `focusFound` here.
   */
  const handleRegionSettled = useCallback((lat: number, lng: number) => {
    setDraft({ lat, lng });
  }, []);

  function startPicking(next: Exclude<Mode, 'idle'>): void {
    const seed =
      next === 'pick-pickup' ? (pickup ?? location.point) : (drop ?? pickup ?? location.point);

    setMode(next);
    setMapPick(false);
    setDraft({ lat: seed.lat, lng: seed.lng });
    setDraftAddress(seed.address.length > 0 ? seed.address : null);
    setSearch('');
    setSearchMissed(false);
    closeSuggestions();
    map.current?.moveTo(seed.lat, seed.lng, 'street');
  }

  function cancelPicking(): void {
    if (mapPick) {
      setMapPick(false);
      return;
    }

    setMode('idle');
    setDraft(null);
    setDraftAddress(null);
    setSearch('');
    setSearchMissed(false);
    closeSuggestions();

    const focus = pickup ?? location.point;
    map.current?.moveTo(focus.lat, focus.lng, 'street');
  }

  function adopt(point: TripPoint, target: Mode): void {
    if (target === 'pick-pickup') {
      pickupIsAutomatic.current = false;
      setPickup(point);
    } else {
      setDrop(point);
    }
  }

  function confirmDraft(): void {
    if (draft === null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    adopt(
      {
        lat: draft.lat,
        lng: draft.lng,
        address: draftAddress ?? describeCoordinate(draft.lat, draft.lng),
      },
      mode,
    );

    setMode('idle');
    setMapPick(false);
    setDraft(null);
    setDraftAddress(null);
    setSearch('');
    setSearchMissed(false);
    closeSuggestions();
  }

  /**
   * A saved place tapped from the IDLE sheet sets the destination — that is what a customer means
   * by tapping "Home" on a home screen. Tapped while picking, it applies to whichever end is
   * being picked instead.
   */
  function applySaved(saved: SavedAddressDto): void {
    const point = fromSavedAddress(saved);
    adopt(point, mode === 'pick-pickup' ? 'pick-pickup' : 'pick-drop');

    setMode('idle');
    setMapPick(false);
    setDraft(null);
    setDraftAddress(null);
    map.current?.moveTo(point.lat, point.lng, 'street');
  }

  /** Dismiss the type-ahead list and end its billing session. */
  function closeSuggestions(): void {
    setSuggestOpen(false);
    places.reset();
  }

  /**
   * A found place becomes the DRAFT, not the choice.
   *
   * Searching drops the pin there and opens the map picker so the customer can nudge it — a
   * geocoded result lands on a rooftop or a road centreline often enough that committing it
   * outright would book pickups at the wrong gate. Confirm is still theirs to press.
   */
  function focusFound(point: TripPoint): void {
    setSearchMissed(false);
    setMapPick(true);
    // Their own words on screen immediately, ahead of the reverse geocode that will confirm them.
    setDraftAddress(point.address);
    /*
     * THE CHOSEN COORDINATE IS THE ANSWER, and it is set here rather than waited for.
     *
     * This used to rely entirely on the map: move the camera, and let `onRegionSettled` report
     * back where it ended up. But `onRegionChangeComplete` fires mid-flight — a search for Sevoke
     * More reported "settled" 271ms into a 450ms animation, 1.7km short — so the point recorded
     * was one the camera was passing over, not the one the customer picked. `MapCanvas` now
     * withholds those reports during its own moves, which leaves nothing to set the draft unless
     * this does.
     *
     * It is also simply better information. The place came from Google with a coordinate attached;
     * asking the camera where it thinks it is can only ever be a worse answer than the one we were
     * given.
     */
    setDraft({ lat: point.lat, lng: point.lng });
    map.current?.moveTo(point.lat, point.lng, 'street');
  }

  /**
   * A tapped suggestion. Only Google's rows need resolving — the device-geocoder fallback carries
   * its coordinate already, and `resolveSuggestion` returns it untouched.
   */
  async function chooseSuggestion(suggestion: PlaceSuggestion): Promise<void> {
    // Close FIRST: the resolve is a network call, and a list left open under the customer's
    // finger invites a second tap on a row that is already being acted on.
    setSuggestOpen(false);
    /*
     * And put the keyboard away with it. Picking a suggestion is the END of typing — the answer
     * has been chosen — but nothing here blurs the field, so the keyboard stayed up and covered
     * the bottom half of the map, which is the half the pin has just moved to. The customer had
     * to dismiss it by hand before they could see what they had picked.
     */
    Keyboard.dismiss();
    setSearch(suggestion.primary);
    setSearching(true);

    const point = await places.select(suggestion);
    setSearching(false);
    // A fresh session for whatever they search next; the token this one used is now spent.
    places.reset();

    if (point === null) {
      setSearchMissed(true);
      return;
    }
    focusFound(point);
  }

  /**
   * Pressing the keyboard's search key.
   *
   * The top suggestion is what the list is already showing them, so that is what "search" means
   * here. Only when there is nothing to take does this fall back to the whole-string geocode —
   * which is also the entire behaviour when no Places key is configured.
   */
  async function runSearch(): Promise<void> {
    const top = places.suggestions[0];
    if (top !== undefined) {
      await chooseSuggestion(top);
      return;
    }

    // Same reasoning as `chooseSuggestion` — this is the other way a search ends, and the map is
    // about to move behind a keyboard that has nothing left to type into.
    setSuggestOpen(false);
    Keyboard.dismiss();
    setSearching(true);
    const found = await forwardGeocode(search);
    setSearching(false);

    if (found === null) {
      setSearchMissed(true);
      return;
    }

    focusFound(found);
  }

  function recentre(): void {
    // The locate button is the customer asking — from any of these it goes to Android's prompt.
    if (
      location.status === 'denied' ||
      location.status === 'failed' ||
      location.status === 'needs-consent'
    ) {
      location.locate();
      return;
    }
    map.current?.moveTo(location.point.lat, location.point.lng, 'street');
  }

  const picking = mode !== 'idle';
  const savedAddresses = profile.data?.saved_addresses ?? [];

  // No markers while picking: the centre pin IS the point being chosen, and a second pin for the
  // same end of the trip reads as two different answers.
  const markers: MapMarker[] = [];
  if (!picking && pickup !== null) {
    markers.push({
      id: 'pickup',
      lat: pickup.lat,
      lng: pickup.lng,
      kind: 'pickup',
      title: 'Pickup',
    });
  }
  if (!picking && drop !== null) {
    markers.push({ id: 'drop', lat: drop.lat, lng: drop.lng, kind: 'drop', title: 'Drop' });
  }

  return (
    <View style={styles.root}>
      <MapCanvas
        ref={map}
        initialCentre={location.point}
        markers={markers}
        showCentrePin={picking && mapPick}
        centrePinKind={mode === 'pick-drop' ? 'drop' : 'pickup'}
        userLocation={location.isReal ? { lat: location.point.lat, lng: location.point.lng } : null}
        bottomInset={sheetHeight}
        onRegionSettled={picking && mapPick ? handleRegionSettled : undefined}
      />

      <View style={styles.topBar} pointerEvents="box-none">
        {picking ? (
          <Animated.View
            key="search"
            style={styles.searchRow}
            entering={FadeInUp.duration(220)}
            exiting={FadeOut.duration(140)}
          >
            {/* The back control is its own circle rather than an icon crammed inside the field.
                Two different actions — leave, and type — should not share one surface. */}
            <GlassPanel rounded="pill">
              <Pressable
                onPress={cancelPicking}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.glassButton, pressed && styles.pressedDim]}
              >
                <Feather name="arrow-left" size={20} color={colors.fg} />
              </Pressable>
            </GlassPanel>

            {/* Liquid glass: the field is a lit pane of glass over the map, not a white card
                dropped on top of it. The frost, the diagonal sheen and the bright rim all
                come from `GlassPanel liquid`; this only lays out what sits on the pane. */}
            <GlassPanel rounded="pill" liquid style={styles.searchGlass}>
              <View style={styles.searchInner}>
                <View style={styles.searchGlyph}>
                  <Feather name="search" size={16} color={colors.onFg} />
                </View>

                <TextInput
                  value={search}
                  onChangeText={(value) => {
                    setSearch(value);
                    setSuggestOpen(true);
                    if (searchMissed) setSearchMissed(false);
                  }}
                  placeholder={
                    mode === 'pick-pickup' ? 'Search a pickup point' : 'Search a destination'
                  }
                  placeholderTextColor={colors.muted}
                  style={styles.searchInput}
                  returnKeyType="search"
                  onSubmitEditing={() => void runSearch()}
                  accessibilityLabel="Search for a place"
                />

                {searching || places.loading ? (
                  <ActivityIndicator size="small" color={colors.muted} />
                ) : search.length > 0 ? (
                  // Clearing a typed query is a one-tap job on every search field a customer has
                  // ever used; making them hold backspace is a small, avoidable annoyance.
                  <Pressable
                    onPress={() => {
                      setSearch('');
                      setSearchMissed(false);
                      closeSuggestions();
                    }}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Clear search"
                    style={({ pressed }) => [styles.searchClear, pressed && styles.pressedDim]}
                  >
                    <Feather name="x" size={14} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
            </GlassPanel>
          </Animated.View>
        ) : null}

        {/* THE SUGGESTION LIST.
            Inside `topBar` and after the row, so it hangs beneath the field it belongs to; the
            back button's width is matched by a spacer so the rows line up with the field rather
            than the screen. `box-none` on the bar means the map is still draggable either side. */}
        {picking && suggestOpen && (places.suggestions.length > 0 || places.empty) ? (
          <Animated.View
            style={styles.suggestRow}
            entering={FadeInDown.duration(180)}
            exiting={FadeOut.duration(120)}
            layout={LinearTransition.duration(200)}
          >
            <View style={styles.suggestSpacer} />
            <GlassPanel rounded="card" liquid style={styles.suggestGlass}>
              {places.suggestions.length === 0 ? (
                <View style={styles.suggestEmpty}>
                  <Text style={styles.suggestEmptyText}>
                    {hasPlacesProvider
                      ? 'No places match that.'
                      : // Without a Places key this is one whole-string lookup, not type-ahead —
                        // so it says what to do about it rather than pretending the place is gone.
                        'No match. Try a fuller address, or drop the pin on the map.'}
                  </Text>
                </View>
              ) : (
                places.suggestions.map((suggestion, index) => (
                  <Pressable
                    key={suggestion.id}
                    onPress={() => void chooseSuggestion(suggestion)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      suggestion.secondary === null
                        ? suggestion.primary
                        : `${suggestion.primary}, ${suggestion.secondary}`
                    }
                    style={({ pressed }) => [
                      styles.suggestItem,
                      index > 0 && styles.suggestDivider,
                      pressed && styles.pressedDim,
                    ]}
                  >
                    <Feather name="map-pin" size={16} color={colors.muted} />
                    <View style={styles.suggestText}>
                      <Text style={styles.suggestPrimary} numberOfLines={1}>
                        {suggestion.primary}
                      </Text>
                      {suggestion.secondary === null ? null : (
                        <Text style={styles.suggestSecondary} numberOfLines={1}>
                          {suggestion.secondary}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))
              )}
            </GlassPanel>
          </Animated.View>
        ) : null}

        {!picking ? (
          <Animated.View
            key="header"
            style={styles.headerRow}
            entering={FadeIn.duration(240)}
            exiting={FadeOut.duration(140)}
          >
            {/* The logo keeps its solid brand fill — it is the one thing on screen that must
                never take its colour from whatever tile happens to be behind it. */}
            <View style={styles.logoChip}>
              <Logo width={64} />
            </View>
            <GlassPanel rounded="pill">
              <Pressable
                onPress={() => router.push('/account')}
                accessibilityRole="button"
                accessibilityLabel="Account"
                style={({ pressed }) => [styles.glassButton, pressed && styles.pressedDim]}
              >
                <Feather name="user" size={20} color={colors.fg} />
              </Pressable>
            </GlassPanel>
          </Animated.View>
        ) : null}

        {searchMissed ? (
          <Animated.Text
            style={styles.pill}
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            layout={LinearTransition.duration(200)}
          >
            No match for that search.
          </Animated.Text>
        ) : null}
        {savedNotice !== null ? (
          <Animated.Text
            style={styles.pill}
            accessibilityLiveRegion="polite"
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(120)}
            layout={LinearTransition.duration(200)}
          >
            {savedNotice}
          </Animated.Text>
        ) : null}

        {/*
          THE WAY BACK INTO A LIVE BOOKING — and the only one. Nothing redirects; this invites.

          It carries the status and the reference rather than just an arrow, because the customer
          has to recognise the trip as theirs before tapping is a decision rather than a gamble.
          Not shown while `picking`, which already covers the screen with the search field, and a
          banner offering to leave a search the customer just started is the wrong prompt.
        */}
        {live !== null && !picking ? (
          <Animated.View
            entering={FadeInDown.duration(220)}
            exiting={FadeOut.duration(140)}
            layout={LinearTransition.duration(200)}
          >
            <GlassPanel rounded="card" style={styles.resumeBanner}>
              <Pressable
                onPress={() =>
                  router.push(
                    live.status === 'SEARCHING' ? `/searching/${live.id}` : `/trip/${live.id}`,
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Resume your trip in progress"
                style={({ pressed }) => [styles.resumeRow, pressed && styles.pressedDim]}
              >
                <View style={styles.resumeIcon}>
                  <Feather name="navigation" size={16} color={colors.fg} />
                </View>
                <View style={styles.resumeText}>
                  <Text style={styles.resumeTitle}>
                    {live.status === 'SEARCHING' ? 'Finding your driver' : 'Trip in progress'}
                  </Text>
                  <Text style={styles.resumeSub}>{live.reference} · tap to carry on</Text>
                </View>
                <Feather name="chevron-right" size={18} color={colors.fg} />
              </Pressable>
            </GlassPanel>
          </Animated.View>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={styles.sheetLayer}
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/*
          THE RECENTRE BUTTON RIDES THE SHEET, so it has to know when to get off.

          It is the first child of `sheetLayer`, which means it sits directly on top of whatever
          sheet is showing — and once both trip points are chosen that sheet carries a summary, the
          trip options and a Continue button. On a normal phone that pushed this circle all the way
          up into the header row, where it landed on top of the account button: two round glass
          controls overlapping, neither fully tappable.

          Hidden rather than repositioned. With a sheet that tall there is barely a strip of map
          left to recentre, so the control has nothing to do; when the customer drags the sheet
          down to see the map — the moment they would actually want it — it comes straight back.
        */}
        {mapRoomAbove >= RECENTRE_MIN_MAP ? (
          <GlassPanel rounded="pill" style={styles.recentre}>
            <Pressable
              onPress={recentre}
              accessibilityRole="button"
              accessibilityLabel="Centre on my location"
              style={({ pressed }) => [styles.glassButton, pressed && styles.pressedDim]}
            >
              <Feather name="navigation" size={18} color={colors.fg} />
            </Pressable>
          </GlassPanel>
        ) : null}

        {picking ? (
          /*
            Draggable, exactly like the home sheet, and for the same reason: a customer
            positioning a pin needs the map more than the list below it, and pushing the sheet
            down is how they get it.

            The ORDER follows from that. Title, pinned address and Confirm sit above the fold so
            collapsing never hides the decision or the button that commits it; only the saved
            list goes under.
          */
          mapPick ? (
            /*
              MAP MODE: the pin, the address under it, and the button that commits it. Nothing
              else. A saved-places list here would be offering a second way to answer a question
              the customer has already chosen how to answer — and every row of it is a row of map
              they cannot see while placing the pin.

              Short and fixed rather than draggable: there is nothing under the fold to reach.
            */
            <Animated.View
              key="pickbar"
              style={styles.pickBar}
              entering={FadeInDown.duration(240)}
              exiting={FadeOut.duration(140)}
              onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
            >
              <View style={styles.draftRow}>
                <Feather name="map-pin" size={16} color={colors.muted} />
                <Text style={styles.draftAddress} numberOfLines={2}>
                  {resolving && draftAddress === null
                    ? 'Finding this place…'
                    : (draftAddress ??
                      (draft === null ? 'Move the map' : describeCoordinate(draft.lat, draft.lng)))}
                </Text>
              </View>

              <View style={styles.pickActions}>
                <Pressable
                  onPress={() => setSaveOpen(true)}
                  accessibilityRole="button"
                  disabled={draft === null || saveAddress.isPending}
                  hitSlop={8}
                  style={({ pressed }) => [styles.saveLink, pressed && styles.pressedDim]}
                >
                  {saveAddress.isPending ? (
                    <ActivityIndicator size="small" color={colors.link} />
                  ) : (
                    <Feather name="bookmark" size={15} color={colors.link} />
                  )}
                  <Text style={styles.saveLinkLabel}>Save this place</Text>
                </Pressable>
              </View>

              <PrimaryButton
                label={mode === 'pick-pickup' ? 'Confirm pickup' : 'Confirm destination'}
                onPress={confirmDraft}
                disabled={draft === null}
                showArrow={false}
              />
            </Animated.View>
          ) : (
            /*
              LIST MODE: the ways to answer without touching the map — a saved place, or the
              search field above. No pin and no Confirm here, because nothing has been pointed at
              yet; offering to confirm would be asking the customer to commit to a place the
              screen has not shown them.
            */
            <DraggableSheet key="pick-list" peekHeight={PICK_PEEK} onHeightChange={setSheetHeight}>
              <Text style={styles.sheetTitle}>
                {mode === 'pick-pickup' ? 'Set your pickup point' : 'Set your destination'}
              </Text>

              <Pressable
                onPress={() => setMapPick(true)}
                accessibilityRole="button"
                accessibilityLabel="Select on map"
                style={({ pressed }) => [styles.mapPickRow, pressed && styles.mapPickPressed]}
              >
                <View style={styles.mapPickIcon}>
                  <Feather name="crosshair" size={17} color={colors.fg} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.mapPickTitle}>Select on map</Text>
                  <Text style={styles.mapPickBody}>Move the map to place the pin</Text>
                </View>
                <Feather name="chevron-right" size={16} color={colors.faint} />
              </Pressable>

              {savedAddresses.length > 0 ? (
                <View style={styles.pickSavedBlock}>
                  <Text style={styles.savedLabel}>Saved places</Text>
                  {savedAddresses.map((saved) => (
                    <SavedPlaceRow
                      key={saved.id}
                      saved={saved}
                      onPress={applySaved}
                      selected={samePoint(
                        mode === 'pick-pickup' ? pickup : drop,
                        fromSavedAddress(saved),
                      )}
                      // Deleting moved here with the list. This is now the ONLY place in the app
                      // a saved place can be removed — Account renders them read-only — so
                      // dropping the prop when the home list went would have deleted the
                      // capability rather than relocated it.
                      onRemove={forgetAddress.mutate}
                      removing={forgetAddress.isPending && forgetAddress.variables?.id === saved.id}
                    />
                  ))}
                </View>
              ) : null}
            </DraggableSheet>
          )
        ) : (
          // Two detents — LARGE (all of it, the default) and SMALL (`HOME_PEEK`, more map
          // showing). Opens fully so the whole trip is in reach; drag down for more map.
          <DraggableSheet key="home" peekHeight={HOME_PEEK} onHeightChange={setSheetHeight}>
            {/*
              THE FIELD SWAPS, THE LIST STAYS. Before a destination exists the sheet asks a
              question with a search field; once one is set, that field gives way to the trip
              itself — a search box still asking "Where are you going?" under an answered
              question is what makes an app feel like it did not hear you.

              The saved list is NOT part of that swap. It stays put with the chosen place marked,
              so a customer can see what they picked and switch to another in one tap instead of
              reopening the picker to change their mind.
            */}
            <TripPointRow
              variant="compact"
              label="Pickup"
              value={pickup?.address ?? null}
              placeholder="Set your pickup point"
              busy={location.status === 'locating'}
              onPress={() => startPicking('pick-pickup')}
            />

            {drop === null ? (
              <View style={styles.heroBlock}>
                <TripPointRow
                  variant="hero"
                  label="Destination"
                  value={null}
                  placeholder="Where are you going?"
                  onPress={() => startPicking('pick-drop')}
                />
              </View>
            ) : (
              <View style={styles.summaryBlock}>
                <TripSummaryCard
                  pickup={pickup}
                  drop={drop}
                  onEditPickup={() => startPicking('pick-pickup')}
                  onEditDrop={() => startPicking('pick-drop')}
                  onClearDrop={() => setDrop(null)}
                />
              </View>
            )}

            {/*
              THE SAVED LIST USED TO BE HERE. It moved rather than went: both pickers still show
              it, which is where it answers the question it is for. This block answers the two the
              sheet cannot ask anywhere else — when, and which way — and both change the price.

              Only once a destination exists. Before that there is no trip to set terms for, and a
              return-time row under an empty destination field is a question about nothing.
            */}
            {drop !== null ? (
              <TripOptions
                serviceType={serviceType}
                direction={direction}
                onDirectionChange={(next) => {
                  void Haptics.selectionAsync();
                  setDirection(next);
                  // Leaving a return time on a one-way trip would keep a value the customer can
                  // no longer see, and silently restore it if they switched back.
                  if (next === 'ONE_WAY') setReturnAt(null);
                }}
                busy={trip.query.isFetching}
                scheduledAt={scheduledAt}
                onPickTime={() => setTimePicker('schedule')}
                // Back to leaving now. Offered on in-city only, which the row itself decides.
                onClearTime={() => setScheduledAt(null)}
                returnAt={returnAt}
                onPickReturn={() => setTimePicker('return')}
                onClearReturn={() => setReturnAt(null)}
              />
            ) : null}

            <CoverageNotice
              state={coverageState}
              retrying={coverage.isFetching}
              onRetry={() => void coverage.refetch()}
            />

            {/*
              THE SECOND BLOCKER, DIRECTLY ABOVE THE BUTTON IT BLOCKS. Coverage says whether we
              come to this pickup; this says whether we sell anything for this particular trip.
              They are different questions with different answers, so they get separate lines
              rather than one notice that would have to explain which of the two it means.

              It renders only when the answer is no. A "yes, we have a package" line would appear
              on every ordinary use of the screen and stop being read, exactly as the coverage
              notice's own silent-on-success rule found.
            */}
            {noPackage && trip.unavailable !== null ? (
              <Animated.View
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(120)}
                style={[styles.notice, styles.tone_bad]}
                accessibilityLiveRegion="polite"
              >
                <Feather
                  name="alert-circle"
                  size={16}
                  color={colors.danger}
                  style={styles.noticeIcon}
                />
                <View style={styles.flex}>
                  <Text style={styles.noticeTitleBad}>
                    {unavailableTitle(trip.unavailable.reason)}
                  </Text>
                  <Text style={styles.noticeBody}>{trip.unavailable.message}</Text>
                </View>
              </Animated.View>
            ) : null}

            {/* Sits directly above Continue, where the customer is looking when the button does
                not respond. See `missingTimeOnly` for why it waits until the time is the only
                thing left. */}
            {missingTimeOnly ? (
              <Animated.View
                entering={FadeIn.duration(180)}
                exiting={FadeOut.duration(120)}
                style={[styles.notice, styles.tone_warn]}
                accessibilityLiveRegion="polite"
              >
                <Feather name="clock" size={16} color={colors.fg} style={styles.noticeIcon} />
                <View style={styles.flex}>
                  {/*
                    THE TITLE ONLY. The body used to spell out "Tap the Pickup row above to choose
                    when the driver should arrive" — an instruction for a row that is on screen,
                    two inches above, already labelled Pickup and already reading "Select a time".
                    Naming what to do next is useful; narrating where the customer is already
                    looking is noise in the one place the sheet is most crowded.
                  */}
                  {/* `instant` is in the test because an in-city trip with no time is not
                      missing one — if this notice is up at all on such a trip, the empty field is
                      the return leg. */}
                  <Text style={styles.noticeTitle}>
                    {scheduledAt === null && !instant
                      ? 'Choose a pickup time'
                      : 'Choose a return time'}
                  </Text>
                </View>
              </Animated.View>
            ) : null}

            <PrimaryButton
              label="Continue"
              onPress={openFareCard}
              // Every reason it can be disabled is already spelled out directly above — the
              // coverage notice, the no-package notice, or the missing-time notice — so the
              // button carries no second line of explanation of its own.
              disabled={!canContinue}
              loading={pricing}
            />
          </DraggableSheet>
        )}
      </KeyboardAvoidingView>

      {/*
        BEFORE ANDROID'S LOCATION PROMPT, once. Closing the sheet counts as "Not now": the
        customer dismissed a question, and re-showing it on every launch would be nagging.
      */}
      <BottomSheet visible={location.status === 'needs-consent'} onClose={location.decline}>
        <View style={styles.consentIcon}>
          <Feather name="map-pin" size={24} color={colors.fg} />
        </View>
        <Text style={styles.consentTitle}>Use your location for pickup?</Text>
        <Text style={styles.consentBody}>
          DriverZone uses your location to set your pickup point and to check that drivers are
          available where you are. It is only used while the app is open. Android will ask you to
          allow it next.
        </Text>
        <PrimaryButton label="Allow" onPress={location.allow} showArrow={false} />
        <Pressable
          onPress={location.decline}
          accessibilityRole="button"
          style={styles.consentDecline}
        >
          <Text style={styles.consentDeclineLabel}>Not now — I&apos;ll set the pickup myself</Text>
        </Pressable>
      </BottomSheet>

      <BottomSheet visible={saveOpen} onClose={() => setSaveOpen(false)}>
        <Text style={styles.menuLabel}>Save this place as</Text>
        <Text style={styles.menuAddress} numberOfLines={2}>
          {draftAddress ?? (draft === null ? '' : describeCoordinate(draft.lat, draft.lng))}
        </Text>

        {SAVE_LABELS.map((option) => (
          <Pressable
            key={option.value}
            onPress={() => saveAddress.mutate(option.value)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
          >
            <Feather
              name={
                option.value === 'HOME'
                  ? 'home'
                  : option.value === 'OFFICE'
                    ? 'briefcase'
                    : 'map-pin'
              }
              size={18}
              color={colors.fg}
            />
            <Text style={styles.menuItemLabel}>{option.title}</Text>
          </Pressable>
        ))}
      </BottomSheet>

      {/*
        `mode="datetime"` gives iOS one combined wheel. Android has no combined mode and shows a
        date dialog followed by a time dialog off the same call, which is the platform's own
        convention rather than something to work around.

        Rendered conditionally, not with a `visible` prop: the component unmounts itself on
        Android after a choice, so keeping it mounted leaves a picker that will not reopen.
      */}
      <FareSheet
        visible={fareOpen}
        onClose={() => setFareOpen(false)}
        trip={trip}
        onRequote={() => void trip.query.refetch()}
        pickup={pickup}
        drop={drop}
      />

      {/*
        KEYED BY FIELD. The chooser seeds its draft once from `value`, so one instance serving two
        rows must remount when the row changes — without the key, opening Return after Pickup
        would open on the pickup's instant.
      */}
      {timePicker !== null ? (
        <DateTimeChooser
          key={timePicker}
          visible
          title={timePicker === 'schedule' ? 'Pickup time' : 'Return time'}
          value={timePicker === 'schedule' ? scheduledAt : returnAt}
          /*
           * A fresh picker opens on the earliest LEGAL instant rather than on "now", so the first
           * thing the customer sees is already a valid answer. The return leg opens an hour after
           * the pickup for the same reason.
           *
           * BOUNDS FOLLOW THE PRODUCT. In-city has no lead time, so its wheel starts at the next
           * clean five minutes and a twenty-minute pickup is an ordinary choice; outstation still
           * opens an hour out. Passing `serviceType` is what stops the picker offering a time the
           * row underneath would then refuse in red.
           */
          anchor={
            timePicker === 'return' && scheduledAt !== null
              ? new Date(scheduledAt.getTime() + 60 * 60_000)
              : defaultScheduleAnchor(serviceType)
          }
          minimumDate={scheduleBounds(serviceType).minimumDate}
          maximumDate={scheduleBounds(serviceType).maximumDate}
          onCancel={() => setTimePicker(null)}
          onConfirm={(at) => {
            if (timePicker === 'schedule') setScheduledAt(at);
            else setReturnAt(at);
            setTimePicker(null);
          }}
        />
      ) : null}
    </View>
  );
}

function CoverageNotice({
  state,
  onRetry,
  retrying = false,
}: {
  state: CoverageState;
  onRetry: () => void;
  retrying?: boolean;
}): ReactElement | null {
  const copy = coverageCopy(state);
  if (copy === null) return null;

  /**
   * FAILED IS NOT SILENT. The check errored and Continue is permanently disabled, so with no
   * visible retry the screen is a dead end — the customer cannot tell coverage failed from
   * coverage being fine. This is the one neutral-tone state that has to render, and it renders
   * with its own affordance rather than a line telling them to "continue".
   */
  if (state.kind === 'failed') {
    return (
      <View style={[styles.notice, styles.tone_warn]} accessibilityLiveRegion="polite">
        <Feather name="wifi-off" size={16} color={colors.fg} style={styles.noticeIcon} />
        <View style={styles.flex}>
          <Text style={styles.noticeTitle}>{copy.title}</Text>
          {copy.body !== null ? <Text style={styles.noticeBody}>{copy.body}</Text> : null}
        </View>
        <Pressable
          onPress={onRetry}
          disabled={retrying}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Retry coverage check"
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressedDim]}
        >
          {retrying ? (
            <ActivityIndicator size="small" color={colors.fg} />
          ) : (
            <>
              <Feather name="refresh-cw" size={13} color={colors.fg} />
              <Text style={styles.retryLabel}>Retry</Text>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  /**
   * SILENCE IS THE CONFIRMATION. Drivers being available is the expected case, not news — the
   * customer typed a destination to book a ride, not to be told the app works. A line that
   * appears on every normal use of the screen stops being read at all, and it was also the
   * single biggest thing sitting between the saved-places list and the Continue button.
   *
   * `checking` is dropped too: coverage answers in well under a second against the seeded data,
   * and a status line that flashes for one frame reads as noise, not as feedback.
   *
   * What SURVIVES: `warn` (a real charge the customer is about to pay) and `bad` (no drivers at
   * this exact spot) — the two states where staying quiet would hide something that changes what
   * happens next.
   */
  if (copy.tone === 'good' || copy.tone === 'neutral') return null;

  const tone = styles[`tone_${copy.tone}`];

  return (
    <View style={[styles.notice, tone]} accessibilityLiveRegion="polite">
      {/* Only `warn` and `bad` ever reach this line — `good` and `neutral` returned above. */}
      <Feather
        name={copy.tone === 'warn' ? 'info' : 'alert-circle'}
        size={16}
        color={colors.fg}
        style={styles.noticeIcon}
      />
      <View style={styles.flex}>
        <Text style={styles.noticeTitle}>{copy.title}</Text>
        {copy.body !== null ? <Text style={styles.noticeBody}>{copy.body}</Text> : null}
      </View>
    </View>
  );
}

/** Five decimals is about a metre — past that a coordinate is noise, not a different place. */
function round(value: number): number {
  return Number(value.toFixed(5));
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgSunken },
  flex: { flex: 1 },
  pressedDim: { opacity: 0.7 },
  danger: { color: colors.danger },

  topBar: { position: 'absolute', left: space.md, right: space.md, top: space.md },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // Brand yellow, not white: the logo is black-on-transparent so it sits correctly on it, and a
  // yellow chip reads as the brand rather than as another floating white card on a pale map.
  logoChip: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    ...shadow.soft,
  },
  glassButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  searchGlyph: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClear: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The pane itself: fills the row beside the back button and carries the drop shadow that
  // lifts the glass off the map. Frost, sheen and rim are the GlassPanel's `liquid` mode.
  searchGlass: {
    flex: 1,
    ...shadow.card,
  },
  searchInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    height: 48,
    paddingLeft: space.sm,
    paddingRight: space.md,
  },
  searchIcon: { paddingRight: space.sm },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
    color: colors.fg,
    height: '100%',
  },
  // Indented past the back button so the rows hang under the FIELD, not the whole row — the list
  // belongs to the input, and lining it up with the circle would read as a menu for that button.
  suggestRow: { flexDirection: 'row', marginTop: space.sm },
  suggestSpacer: { width: 44 + space.sm },
  suggestGlass: { flex: 1, ...shadow.card },
  suggestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 52,
  },
  suggestDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  suggestText: { flex: 1 },
  suggestPrimary: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  suggestSecondary: { ...text.caption, color: colors.muted, marginTop: 1 },
  suggestEmpty: { paddingHorizontal: space.md, paddingVertical: space.sm },
  suggestEmptyText: { ...text.caption, color: colors.muted },

  pill: {
    ...text.caption,
    color: colors.fg,
    backgroundColor: colors.brandSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    marginTop: space.sm,
    alignSelf: 'flex-start',
    overflow: 'hidden',
  },
  resumeBanner: { marginTop: space.sm, overflow: 'hidden' },
  resumeRow: { flexDirection: 'row', alignItems: 'center', padding: space.sm },
  resumeIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resumeText: { flex: 1, marginLeft: space.sm },
  resumeTitle: { ...text.label, color: colors.fg },
  resumeSub: { ...text.caption, color: colors.muted, marginTop: 1 },

  // Everything that floats above the map bottom-up. `box-none` so map gestures still reach the
  // map everywhere this layer is transparent.
  sheetLayer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  recentre: {
    alignSelf: 'flex-end',
    marginRight: space.md,
    marginBottom: space.md,
    ...shadow.soft,
  },

  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    ...shadow.card,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: space.sm,
  },
  sheetTitle: { ...text.heading, color: colors.fg, marginBottom: space.md },

  heroBlock: { marginTop: space.md, marginBottom: space.lg },
  summaryBlock: { marginTop: space.md, marginBottom: space.lg },

  // Capped rather than free-growing: four saved places must not push Continue off the screen.
  savedLabel: { ...text.label, color: colors.muted, marginBottom: space.sm },
  // Shorter than the idle sheet's list: this sheet also carries a title, the pinned address, the
  // save link and a confirm button, and the confirm button must never be pushed off screen.
  pickBar: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    ...shadow.card,
  },
  mapPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    marginBottom: space.md,
  },
  mapPickPressed: { backgroundColor: colors.bgSunken },
  mapPickIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPickTitle: { ...text.label, color: colors.fg },
  mapPickBody: { ...text.caption, color: colors.muted, marginTop: 1 },
  pickSavedBlock: { marginBottom: space.md },
  pickSavedScroll: { maxHeight: 132 },

  draftRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.sm },
  draftAddress: { ...text.body, color: colors.fg, flex: 1, marginLeft: space.sm },

  pickActions: { marginBottom: space.md },
  saveLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  saveLinkLabel: {
    ...text.body,
    color: colors.link,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
  },

  // `good` and `neutral` never render — see the early return in `CoverageNotice` — so only the
  // two tones actually used are declared below.
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space.sm,
    marginBottom: space.sm,
  },
  noticeIcon: { marginRight: space.sm, marginTop: 1 },
  noticeTitle: { ...text.label, color: colors.fg },
  // Red ink for the one notice that stops the flow outright. The coverage notice's `tone_bad`
  // keeps ink titles because it sits beside a retry; this one has no way forward, so the colour
  // is doing the work the missing button would have.
  noticeTitleBad: { ...text.label, color: colors.danger },
  noticeBody: { ...text.caption, color: colors.muted, marginTop: 2 },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'center',
    marginLeft: space.sm,
    minWidth: 64,
    justifyContent: 'center',
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
  },
  retryLabel: {
    ...text.caption,
    color: colors.fg,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
  },
  // Tone is carried by a tinted surface with an ink label, never by coloured text: the brand
  // yellow is a surface at 1.1:1 against white and nothing readable is ever painted in it.
  tone_warn: { backgroundColor: colors.brandSoft, borderColor: '#E8E8A8' },
  tone_bad: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2' },

  // No top margin: Continue follows the coverage notice (or the saved list, when the notice is
  // silent) directly, closing the gap that made this the tallest empty stretch in the sheet.

  consentIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  consentTitle: { ...text.heading, color: colors.fg },
  consentBody: { ...text.body, color: colors.muted, marginTop: space.xs, marginBottom: space.lg },
  consentDecline: { alignItems: 'center', paddingVertical: space.md },
  consentDeclineLabel: { ...text.body, color: colors.muted },
  menuLabel: { ...text.caption, color: colors.muted },
  menuAddress: { ...text.body, color: colors.fg, marginTop: 2, marginBottom: space.md },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  menuItemPressed: { backgroundColor: colors.bgSunken },
  menuItemLabel: {
    ...text.body,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
    color: colors.fg,
  },
});
