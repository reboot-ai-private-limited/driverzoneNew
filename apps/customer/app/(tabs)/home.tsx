import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { AddressLabel, SavedAddressDto } from '@driverzone/contracts';
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
import { forwardGeocode, reverseGeocode } from '@/features/location/geocoding';
import { useCurrentLocation } from '@/features/location/useCurrentLocation';
import { checkCoverage } from '@/lib/api/endpoints/coverage';
import { addAddress, getProfile, removeAddress } from '@/lib/api/endpoints/customer';
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
 * **Where it stops, deliberately.** `POST /quotes` and the `bookings` module do not exist yet
 * (`apps/api/src/routes.ts` mounts identity, zones, settings and packages only), so Continue has
 * nowhere to go and says so. This screen also does NOT decide incity versus outstation:
 * docs/LLD/api-contracts.md makes that a server decision — the quote response carries
 * `service_type` and the `DROP_OUTSIDE_CITY` suggestion — and an app that guessed would be a
 * second pricing brain to keep in step.
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
  const [saveOpen, setSaveOpen] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  /**
   * How much map the sheet covers, so the centre pin and the reported coordinate both land in
   * the VISIBLE middle. Measured rather than assumed: both sheets change height with content,
   * and a collapsed sheet covers only its peek.
   */
  const [sheetHeight, setSheetHeight] = useState(0);
  /**
   * Within a picking mode: is the customer placing the pin themselves?
   *
   * A sub-state rather than a third `Mode`, because it does not change WHAT is being chosen —
   * only how. Every exit from picking clears it, so the picker always opens on the list.
   */
  const [mapPick, setMapPick] = useState(false);

  /**
   * True while the pickup is still the device's own position rather than something the customer
   * chose. A later, more accurate fix may overwrite an automatic pickup; it must never overwrite
   * one they set by hand.
   */
  const pickupIsAutomatic = useRef(true);
  /** The map follows the first real fix only. After that it is the customer's to move. */
  const hasCentred = useRef(false);

  useEffect(() => {
    if (!location.isReal) return;

    if (pickupIsAutomatic.current) setPickup(location.point);

    if (!hasCentred.current) {
      hasCentred.current = true;
      map.current?.moveTo(location.point.lat, location.point.lng, 'street');
    }
  }, [location.isReal, location.point]);

  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

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

  async function runSearch(): Promise<void> {
    setSearching(true);
    const found = await forwardGeocode(search);
    setSearching(false);

    if (found === null) {
      setSearchMissed(true);
      return;
    }

    setSearchMissed(false);
    setMapPick(true);
    // The map moving fires `onRegionSettled`, which sets the draft coordinate; this only gets
    // the customer's own words on screen ahead of the reverse geocode.
    setDraftAddress(found.address);
    map.current?.moveTo(found.lat, found.lng, 'street');
  }

  function recentre(): void {
    if (location.status === 'denied' || location.status === 'failed') {
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
        userLocation={location.isReal ? { lat: location.point.lat, lng: location.point.lng } : null}
        bottomInset={sheetHeight}
        onRegionSettled={picking && mapPick ? handleRegionSettled : undefined}
      />

      <View style={styles.topBar} pointerEvents="box-none">
        {picking ? (
          <View style={styles.searchRow}>
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

            <View style={styles.searchBar}>
              <View style={styles.searchGlyph}>
                <Feather name="search" size={16} color={colors.onFg} />
              </View>

              <TextInput
                value={search}
                onChangeText={(value) => {
                  setSearch(value);
                  if (searchMissed) setSearchMissed(false);
                }}
                placeholder={
                  mode === 'pick-pickup' ? 'Search a pickup point' : 'Search a destination'
                }
                placeholderTextColor={colors.faint}
                style={styles.searchInput}
                returnKeyType="search"
                onSubmitEditing={() => void runSearch()}
                accessibilityLabel="Search for a place"
              />

              {searching ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : search.length > 0 ? (
                // Clearing a typed query is a one-tap job on every search field a customer has
                // ever used; making them hold backspace is a small, avoidable annoyance.
                <Pressable
                  onPress={() => {
                    setSearch('');
                    setSearchMissed(false);
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
          </View>
        ) : (
          <View style={styles.headerRow}>
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
          </View>
        )}

        {searchMissed ? <Text style={styles.pill}>No match for that search.</Text> : null}
        {savedNotice !== null ? (
          <Text style={styles.pill} accessibilityLiveRegion="polite">
            {savedNotice}
          </Text>
        ) : null}
      </View>

      <KeyboardAvoidingView
        style={styles.sheetLayer}
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
            <View
              style={styles.pickBar}
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
            </View>
          ) : (
            /*
              LIST MODE: the ways to answer without touching the map — a saved place, or the
              search field above. No pin and no Confirm here, because nothing has been pointed at
              yet; offering to confirm would be asking the customer to commit to a place the
              screen has not shown them.
            */
            <DraggableSheet peekHeight={PICK_PEEK} onHeightChange={setSheetHeight}>
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
                    />
                  ))}
                </View>
              ) : null}
            </DraggableSheet>
          )
        ) : (
          <DraggableSheet onHeightChange={setSheetHeight}>
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

            {savedAddresses.length > 0 ? (
              <View style={styles.savedBlock}>
                <ScrollView
                  style={styles.savedScroll}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {savedAddresses.map((saved) => (
                    <SavedPlaceRow
                      key={saved.id}
                      saved={saved}
                      onPress={applySaved}
                      // Compared by COORDINATE, not by id: the same place can also be reached by
                      // dropping a pin on it, and it is the same destination either way.
                      selected={samePoint(drop, fromSavedAddress(saved))}
                      onRemove={forgetAddress.mutate}
                      removing={forgetAddress.isPending && forgetAddress.variables?.id === saved.id}
                    />
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <CoverageNotice state={coverageState} />

            <PrimaryButton
              label="Continue"
              onPress={() => undefined}
              // Permanently inert, and honestly labelled below. Enabling it would promise a
              // fare screen that does not exist.
              disabled
            />
            <Text style={styles.pendingNote}>
              Fares and booking open once the quotes service goes live.
            </Text>
          </DraggableSheet>
        )}
      </KeyboardAvoidingView>

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
    </View>
  );
}

function CoverageNotice({ state }: { state: CoverageState }): ReactElement | null {
  const copy = coverageCopy(state);
  if (copy === null) return null;

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
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClear: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: space.sm,
    height: 56,
    paddingLeft: space.sm,
    paddingRight: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
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

  heroBlock: { marginTop: space.sm, marginBottom: space.md },
  summaryBlock: { marginTop: space.sm, marginBottom: space.md },

  // Capped rather than free-growing: four saved places must not push Continue off the screen.
  savedBlock: { marginBottom: space.sm },
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
  savedScroll: { maxHeight: 148 },

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
  noticeBody: { ...text.caption, color: colors.muted, marginTop: 2 },
  // Tone is carried by a tinted surface with an ink label, never by coloured text: the brand
  // yellow is a surface at 1.1:1 against white and nothing readable is ever painted in it.
  tone_warn: { backgroundColor: colors.brandSoft, borderColor: '#E8E8A8' },
  tone_bad: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2' },

  // No top margin: Continue follows the coverage notice (or the saved list, when the notice is
  // silent) directly, closing the gap that made this the tallest empty stretch in the sheet.
  pendingNote: { ...text.caption, color: colors.muted, textAlign: 'center', marginTop: space.xs },

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
