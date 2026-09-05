import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import type {
  CarCategory,
  Gender,
  UpdateDriverProfileRequest,
  VehicleTypePreference,
} from '@driverzone/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FieldRow } from '@/components/FieldRow';
import { PrimaryButton } from '@/components/PrimaryButton';
import { uploadFile } from '@/lib/api/client';
import {
  getProfile,
  requestProfilePictureUpload,
  updateProfile,
} from '@/lib/api/endpoints/driver';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

/**
 * The driver's details. Four fields are REQUIRED before an admin will review the application
 * (`full_name`, `dob`, `gender`, `address` — apps/api/.../driverOnboarding.entity.ts); the rest
 * are useful but optional.
 *
 * The form is a local DRAFT, not a live-bound profile. The alternative — patching on every
 * keystroke — sends a request per character and, worse, leaves the driver's record in a
 * half-edited state if they abandon the screen. One save, one PATCH.
 */

interface Draft {
  fullName: string;
  dob: Date | null;
  gender: Gender | null;
  address: string;
  experienceYears: string;
  alternateNumber: string;
  /** Every type this driver is competent to drive. Server caps the array at 3. */
  vehicleTypePreferences: readonly VehicleTypePreference[];
  /** Which car categories this driver is competent to drive. Server caps the array at 20. */
  vehicleCategoryPreference: readonly CarCategory[];
  /** Both halves are required together — the server rejects a name with no number. */
  emergencyName: string;
  emergencyNumber: string;
  /**
   * The storage KEY, not a URL.
   *
   * `DriverProfileDto.profile_picture` carries the key the server stored; unlike a document —
   * which `documentToDto` resolves into a signed `url` — there is no download link for it in the
   * profile response. So a picture saved on a previous run cannot be displayed, only known to
   * exist. `pictureUri` below holds a locally-picked preview for the one that just changed.
   */
  profilePicture: string | null;
  canDriveHill: boolean;
}

/**
 * The option lists are declared HERE, not imported from `@driverzone/contracts`.
 *
 * That package says of itself: *"Types only. Nothing here compiles to JavaScript, so importing
 * it costs a client nothing at runtime."* Its `GENDERS` / `VEHICLE_TYPE_PREFERENCES` consts do
 * compile to JS, so pulling one in makes Metro resolve the package for real — and its source
 * uses NodeNext `./http.js` specifiers that Metro cannot map back to `.ts`. The bundle fails
 * with `Unable to resolve "./http.js"`. Every other import in both mobile apps is `import type`,
 * which is erased before Metro ever sees it, which is why nothing had hit this until now.
 *
 * Declaring them locally is also the better answer regardless of Metro: a form needs a DISPLAY
 * ORDER and labels, which are presentation concerns the wire format has no opinion about.
 *
 * **Drift is still caught at compile time.** The label maps are `Record<Gender, …>` and
 * `Record<VehicleTypePreference, …>` — exhaustive over the union — so adding a value to
 * contracts fails this file's typecheck until it is handled here. The `readonly Gender[]`
 * annotations catch a value that is removed or renamed.
 */
const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
};

const GENDER_OPTIONS: readonly Gender[] = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'];

const VEHICLE_LABELS: Record<VehicleTypePreference, string> = {
  AUTO: 'Automatic',
  MANUAL: 'Manual',
  EV: 'Electric',
};

const VEHICLE_OPTIONS: readonly VehicleTypePreference[] = ['AUTO', 'MANUAL', 'EV'];

/**
 * Car categories, mirroring `CAR_CATEGORIES` / `CAR_CATEGORY_LABELS` in contracts for the same
 * reason as the two lists above — importing them would make Metro resolve the package at runtime.
 * `Record<CarCategory, string>` keeps this exhaustive: a category added to contracts breaks this
 * file until it is handled here.
 *
 * These are what dispatch matches a booking's requested category against, so the list a driver
 * ticks here decides which trips they can be OFFERED (`prd.md` FR-B6). Empty means no restriction
 * has been declared, not that they drive nothing.
 */
const CAR_CATEGORY_LABELS: Record<CarCategory, string> = {
  HATCHBACK: 'Hatchback',
  SEDAN: 'Sedan',
  SUV: 'SUV',
  LUXURY: 'Luxury',
  EV: 'EV',
};

const CAR_CATEGORY_OPTIONS: readonly CarCategory[] = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY', 'EV'];

export default function OnboardingProfileScreen(): ReactElement {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });

  const [draft, setDraft] = useState<Draft | null>(null);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** A locally-picked photo, shown until the form is saved. See `Draft.profilePicture`. */
  const [pictureUri, setPictureUri] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);

  /**
   * Uploading the avatar is a THREE-step flow, and it has to finish before the form is saved:
   * presign, send the bytes, and only then does a `storage_key` exist to put in the PATCH.
   *
   * It is its own mutation rather than part of `handleSave` so the driver sees the photo land
   * (or fail) at the moment they choose it, instead of discovering on Save that the one slow
   * part of the form did not work.
   */
  const picture = useMutation({
    mutationFn: async ({ uri, mimeType }: { uri: string; mimeType: string }) => {
      const ticket = await requestProfilePictureUpload();
      await uploadFile(ticket.upload_url, uri, mimeType, ticket.upload_fields);
      return ticket.storage_key;
    },
    onMutate: ({ uri }) => {
      setPictureError(null);
      setPictureUri(uri);
    },
    onSuccess: (storageKey) => patch({ profilePicture: storageKey }),
    onError: (cause) => {
      // Drop the preview: leaving it up would show a photo that is not stored anywhere, which is
      // the same lie the documents screen goes out of its way to avoid.
      setPictureUri(null);
      setPictureError(
        cause instanceof Error ? cause.message : 'The photo did not upload. Please try again.',
      );
    },
  });

  async function pickPicture(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPictureError('DriverZone needs access to your photos to set a profile picture.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Square, because it renders in a circle everywhere it appears — cropping here beats
      // centre-cropping someone's head out of frame at display time.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (asset === undefined) return;

    picture.mutate({ uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' });
  }

  /**
   * Seed the draft ONCE, from the first successful fetch.
   *
   * The guard on `draft === null` is load-bearing: a background refetch (this query has a 30s
   * stale time) would otherwise overwrite whatever the driver has typed since. Losing a
   * half-filled address to a refetch is the kind of bug that only shows on a slow connection.
   */
  useEffect(() => {
    if (profile.data === undefined || draft !== null) return;
    setDraft({
      fullName: profile.data.full_name ?? '',
      dob: profile.data.dob === null ? null : new Date(profile.data.dob),
      gender: profile.data.gender,
      address: profile.data.address ?? '',
      experienceYears:
        profile.data.experience_years === null ? '' : String(profile.data.experience_years),
      alternateNumber: profile.data.alternate_number ?? '',
      vehicleTypePreferences: profile.data.vehicle_type_preferences,
      // The DTO types this as `string[]` because the server stores free codes; narrowing to the
      // ones we can render keeps an unknown value from becoming an unlabelled chip.
      vehicleCategoryPreference: profile.data.vehicle_category_preference.filter(
        (code): code is CarCategory => code in CAR_CATEGORY_LABELS,
      ),
      emergencyName: profile.data.emergency_contact?.name ?? '',
      emergencyNumber: profile.data.emergency_contact?.number ?? '',
      profilePicture: profile.data.profile_picture,
      canDriveHill: profile.data.can_drive_hill,
    });
  }, [profile.data, draft]);

  const save = useMutation({
    mutationFn: (body: UpdateDriverProfileRequest) => updateProfile(body),
    onMutate: () => setSaveError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.profile.all() });
      router.back();
    },
    onError: (cause) => {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save your details.');
    },
  });

  if (profile.isPending || draft === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.fg} />
      </View>
    );
  }

  function patch(next: Partial<Draft>): void {
    setDraft((current) => (current === null ? current : { ...current, ...next }));
    if (saveError !== null) setSaveError(null);
  }

  function handleSave(): void {
    if (draft === null) return;

    /**
     * Built by OMISSION, not by sending the whole form.
     *
     * `PATCH` here means "an absent key changes nothing, an explicit `null` clears the field"
     * (docs/LLD/user.md). Sending `alternate_number: null` for a box the driver simply left
     * empty would erase a number they entered on another device. So an empty optional string
     * sends nothing at all, and only fields with a value are included.
     */
    const body: UpdateDriverProfileRequest = {
      full_name: draft.fullName.trim(),
      address: draft.address.trim(),
      can_drive_hill: draft.canDriveHill,
    };

    if (draft.dob !== null) body.dob = toIsoDate(draft.dob);
    if (draft.gender !== null) body.gender = draft.gender;

    const years = Number.parseInt(draft.experienceYears, 10);
    if (!Number.isNaN(years)) body.experience_years = years;

    const alternate = draft.alternateNumber.trim();
    if (alternate !== '') body.alternate_number = alternate;

    // Both multi-select sets are always sent, including as an empty array — "unchecked
    // everything" is a real answer the driver may need to give, and omitting it would leave a
    // previous selection standing with no way to clear it.
    body.vehicle_type_preferences = [...draft.vehicleTypePreferences];
    body.vehicle_category_preference = [...draft.vehicleCategoryPreference];

    /**
     * Emergency contact is ALL OR NOTHING.
     *
     * `emergencyContact` on the server is an object with two required strings, so a name with no
     * number fails validation for the whole PATCH — the driver would lose their other edits to a
     * field they only half-filled. Both present sends the pair; both blank sends `null` to clear
     * it; exactly one filled sends nothing at all and leaves whatever is stored alone, which is
     * the only option that neither errors nor silently discards half of what they typed.
     */
    const emergencyName = draft.emergencyName.trim();
    const emergencyNumber = draft.emergencyNumber.trim();
    if (emergencyName !== '' && emergencyNumber !== '') {
      body.emergency_contact = { name: emergencyName, number: emergencyNumber };
    } else if (emergencyName === '' && emergencyNumber === '') {
      body.emergency_contact = null;
    }

    // Only when there is a key — set by a completed upload, or carried in from the stored
    // profile. Sending `null` for a driver who simply did not touch the avatar would delete a
    // picture they uploaded on another device.
    if (draft.profilePicture !== null) body.profile_picture = draft.profilePicture;

    save.mutate(body);
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Your details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/*
            The avatar sits above the form rather than inside it because it does not save with
            the form — the upload runs on pick, and only its resulting key travels with the PATCH.
          */}
          <View style={styles.avatarBlock}>
            <Pressable
              onPress={() => void pickPicture()}
              disabled={picture.isPending}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo"
              style={styles.avatar}
            >
              {picture.isPending ? (
                <ActivityIndicator color={colors.fg} />
              ) : pictureUri !== null ? (
                <Image source={{ uri: pictureUri }} style={styles.avatarImage} />
              ) : (
                <Feather name="camera" size={24} color={colors.muted} />
              )}
              <View style={styles.avatarBadge}>
                <Feather name="edit-2" size={11} color={colors.brandOnFg} />
              </View>
            </Pressable>

            <Text style={styles.avatarHint}>
              {pictureUri !== null
                ? 'Photo ready — save to attach it'
                : draft.profilePicture !== null
                  ? 'A photo is already saved. Tap to replace it.'
                  : 'Add a profile photo (optional)'}
            </Text>

            {pictureError !== null ? (
              <Text style={styles.avatarError} accessibilityLiveRegion="polite">
                {pictureError}
              </Text>
            ) : null}
          </View>

          <FieldRow
            label="Full name"
            required
            icon="user"
            focused={focusedField === 'fullName'}
          >
            <TextInput
              value={draft.fullName}
              onChangeText={(value) => patch({ fullName: value })}
              onFocus={() => setFocusedField('fullName')}
              onBlur={() => setFocusedField(null)}
              placeholder="As printed on your licence"
              placeholderTextColor={colors.faint}
              style={styles.input}
              autoCapitalize="words"
            />
          </FieldRow>

          <FieldRow label="Date of birth" required icon="calendar">
            <Pressable onPress={() => setShowDatePicker(true)} accessibilityRole="button">
              <Text style={draft.dob === null ? styles.placeholder : styles.inputText}>
                {draft.dob === null ? 'Select your date of birth' : formatDate(draft.dob)}
              </Text>
            </Pressable>
          </FieldRow>

          <FieldRow label="Gender" required boxed={false}>
            <View style={styles.chipRow}>
              {GENDER_OPTIONS.map((value) => (
                <Chip
                  key={value}
                  label={GENDER_LABELS[value]}
                  selected={draft.gender === value}
                  onPress={() => patch({ gender: value })}
                />
              ))}
            </View>
          </FieldRow>

          <FieldRow label="Address" required icon="map-pin" focused={focusedField === 'address'}>
            <TextInput
              value={draft.address}
              onChangeText={(value) => patch({ address: value })}
              onFocus={() => setFocusedField('address')}
              onBlur={() => setFocusedField(null)}
              placeholder="Where you are based"
              placeholderTextColor={colors.faint}
              style={[styles.input, styles.inputMultiline]}
              multiline
            />
          </FieldRow>

          <Text style={styles.sectionHeading}>Optional</Text>

          <FieldRow
            label="Years of driving experience"
            icon="award"
            focused={focusedField === 'experience'}
          >
            <TextInput
              value={draft.experienceYears}
              onChangeText={(value) => patch({ experienceYears: value.replace(/[^0-9]/g, '').slice(0, 2) })}
              onFocus={() => setFocusedField('experience')}
              onBlur={() => setFocusedField(null)}
              placeholder="e.g. 8"
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              style={styles.input}
            />
          </FieldRow>

          <FieldRow
            label="Alternate number"
            hint="(Optional)"
            icon="phone"
            focused={focusedField === 'alternate'}
          >
            <TextInput
              value={draft.alternateNumber}
              onChangeText={(value) => patch({ alternateNumber: value })}
              onFocus={() => setFocusedField('alternate')}
              onBlur={() => setFocusedField(null)}
              placeholder="+91 00000 00000"
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </FieldRow>

          {/* Competence, not ownership: the driver drives the CUSTOMER'S car
              (docs/LLD/open-questions.md Q5), so this says what they can handle, not what they
              have parked outside.

              Multi-select, like "Car types" below — someone who drives a manual almost always
              drives an automatic too, and an EV is a third thing again. A single value used to
              split the driver pool three ways and starved every dispatch wave (see
              `VEHICLE_TYPE_PREFERENCES` in contracts); the server caps this set at 3. */}
          <FieldRow label="Transmission you can drive" hint="(choose any)" boxed={false}>
            <View style={styles.chipRow}>
              {VEHICLE_OPTIONS.map((value) => {
                const selected = draft.vehicleTypePreferences.includes(value);
                return (
                  <Chip
                    key={value}
                    label={VEHICLE_LABELS[value]}
                    selected={selected}
                    multiSelect
                    onPress={() =>
                      patch({
                        vehicleTypePreferences: selected
                          ? draft.vehicleTypePreferences.filter((code) => code !== value)
                          : [...draft.vehicleTypePreferences, value],
                      })
                    }
                  />
                );
              })}
            </View>
          </FieldRow>

          {/* Multi-select, unlike the rows above: a driver comfortable in a hatchback is usually
              fine in a sedan too, and this is what decides which bookings they can be OFFERED
              (`prd.md` FR-B6) rather than what any of them costs. */}
          <FieldRow
            label="Car types you can drive"
            hint="(choose any)"
            boxed={false}
          >
            <View style={styles.chipRow}>
              {CAR_CATEGORY_OPTIONS.map((value) => {
                const selected = draft.vehicleCategoryPreference.includes(value);
                return (
                  <Chip
                    key={value}
                    label={CAR_CATEGORY_LABELS[value]}
                    selected={selected}
                    multiSelect
                    onPress={() =>
                      patch({
                        vehicleCategoryPreference: selected
                          ? draft.vehicleCategoryPreference.filter((code) => code !== value)
                          : [...draft.vehicleCategoryPreference, value],
                      })
                    }
                  />
                );
              })}
            </View>
          </FieldRow>

          {/*
            Emergency contact. Both halves or neither — see the note in `handleSave`: the server
            takes this as one object with two required strings, so half of it fails the whole
            PATCH and would cost the driver their other edits.
          */}
          <FieldRow
            label="Emergency contact name"
            hint="(Optional)"
            icon="user"
            focused={focusedField === 'emergencyName'}
          >
            <TextInput
              value={draft.emergencyName}
              onChangeText={(value) => patch({ emergencyName: value })}
              onFocus={() => setFocusedField('emergencyName')}
              onBlur={() => setFocusedField(null)}
              placeholder="Who should we call"
              placeholderTextColor={colors.faint}
              style={styles.input}
              autoCapitalize="words"
            />
          </FieldRow>

          <FieldRow
            label="Emergency contact number"
            hint={draft.emergencyName.trim() === '' ? '(Optional)' : '(needed with the name)'}
            icon="phone-call"
            focused={focusedField === 'emergencyNumber'}
          >
            <TextInput
              value={draft.emergencyNumber}
              onChangeText={(value) => patch({ emergencyNumber: value })}
              onFocus={() => setFocusedField('emergencyNumber')}
              onBlur={() => setFocusedField(null)}
              placeholder="+91 00000 00000"
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              style={styles.input}
            />
          </FieldRow>

          {/*
            Self-declared, and it gates nothing on its own. Hill dispatch reads
            `can_drive_hill_verified`, which only an admin can set (docs/LLD/user.md). Saying so
            here stops a driver assuming they will start getting hill trips the moment they tick
            the box.
          */}
          <Pressable
            onPress={() => patch({ canDriveHill: !draft.canDriveHill })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.canDriveHill }}
            style={styles.toggleRow}
          >
            <View style={[styles.checkbox, draft.canDriveHill && styles.checkboxOn]}>
              {draft.canDriveHill ? <Feather name="check" size={15} color={colors.onFg} /> : null}
            </View>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>I can drive hill routes</Text>
              <Text style={styles.toggleHint}>An admin confirms this before hill trips are offered.</Text>
            </View>
          </Pressable>

          {saveError !== null ? (
            <Text style={styles.saveError} accessibilityLiveRegion="polite">
              {saveError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton label="Save details" onPress={handleSave} loading={save.isPending} showArrow={false} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {showDatePicker ? (
        <DateTimePicker
          value={draft.dob ?? defaultDobAnchor()}
          mode="date"
          // A wheel rather than a calendar grid: picking a birth year 30 years back is many taps
          // of a month-by-month calendar and one flick of a wheel.
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(event, selected) => {
            // Android fires with type 'dismissed' on cancel and unmounts itself either way.
            setShowDatePicker(Platform.OS === 'ios');
            if (event.type === 'set' && selected !== undefined) patch({ dob: selected });
          }}
        />
      ) : null}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  multiSelect = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** True for a set where more than one chip can be on at once — reported as a checkbox rather
   *  than a radio button, since only one radio in a group is ever supposed to be selected. */
  multiSelect?: boolean;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={multiSelect ? 'checkbox' : 'radio'}
      accessibilityState={multiSelect ? { checked: selected } : { selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

/**
 * `Date` → `YYYY-MM-DD`, in LOCAL time.
 *
 * `toISOString()` is the obvious call and it is wrong here: it converts to UTC first, so a
 * birthday picked as 12 March in IST (UTC+5:30) serialises as 11 March. A date of birth has no
 * time zone — it is the date on the licence — so the local components are what must be sent.
 */
function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Opens the wheel at a plausible birth year rather than today, saving ~30 flicks. */
function defaultDobAnchor(): Date {
  const anchor = new Date();
  anchor.setFullYear(anchor.getFullYear() - 30);
  return anchor;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSpacer: { width: 22 },

  scroll: { padding: space.lg, paddingBottom: space.xl },

  avatarBlock: { alignItems: 'center', marginBottom: space.lg },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    // The badge hangs off the edge; without this it is clipped to the circle.
    overflow: 'visible',
  },
  avatarImage: { width: 96, height: 96, borderRadius: radius.pill },
  avatarBadge: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarHint: { ...text.caption, color: colors.muted, marginTop: space.sm, textAlign: 'center' },
  avatarError: { ...text.caption, color: colors.danger, marginTop: space.xs, textAlign: 'center' },

  input: { ...text.body, color: colors.fg, paddingVertical: space.sm },
  inputMultiline: { minHeight: 44, textAlignVertical: 'top' },
  inputText: { ...text.body, color: colors.fg, paddingVertical: space.sm + 3 },
  placeholder: { ...text.body, color: colors.faint, paddingVertical: space.sm + 3 },

  sectionHeading: {
    ...text.label,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: space.md,
    marginBottom: space.md,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  chipSelected: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted },
  chipLabelSelected: { color: colors.brandOnFg },

  toggleRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  toggleText: { flex: 1, marginLeft: space.sm },
  toggleLabel: { ...text.body, color: colors.fg },
  toggleHint: { ...text.caption, color: colors.muted, marginTop: 2 },

  saveError: { ...text.caption, color: colors.danger, marginTop: space.md },
  actions: { marginTop: space.xl },
});
