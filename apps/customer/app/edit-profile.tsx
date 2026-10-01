import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import type {
  CustomerProfileDto,
  EmergencyContactDto,
  Gender,
  UpdateCustomerProfileRequest,
} from '@driverzone/contracts';
import { FieldRow } from '@/components/FieldRow';
import { PrimaryButton } from '@/components/PrimaryButton';
import { INDIA_DIALLING_CODE, isValidIndianMobile, normaliseInput, toE164 } from '@/features/auth/phoneNumber';
import {
  GENDER_OPTIONS,
  LANGUAGE_OPTIONS,
  formatDob,
  toDateOnly,
} from '@/features/profile/completion';
import { getProfile, updateProfile } from '@/lib/api/endpoints/customer';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * Edit an EXISTING profile — reached from Account, not the sign-up flow.
 *
 * This is a separate screen from `(auth)/profile-setup` on purpose. That one starts from
 * `EMPTY_DRAFT`, always routes to `/home`, and wears onboarding chrome (the wave, the progress
 * ring, "Skip for now"). Pointing "Edit profile" at it showed the customer a blank form and
 * offered to erase everything they had. This screen loads `GET /customer/profile`, prefills, and
 * PATCHes only what actually changed.
 *
 * Scope is every field `PATCH /customer/profile` persists AND this app can collect without a
 * screen it does not have:
 *
 *   - Personal: `full_name`, `gender`, `dob`.
 *   - Safety & contact: `languages_known`, `alternate_number`, `emergency_contact`. These were in
 *     the contract and stored by the server from the start but had no screen anywhere — a
 *     customer could not fill them in, and the completion bar could never reach 100%.
 *
 * Photo and email are still absent: `CustomerProfileDto` has no field for either yet, so there is
 * nothing to PATCH and a control here would be a dead end.
 */

interface Form {
  fullName: string;
  gender: Gender | null;
  dob: Date | null;
  /** Free list; `LANGUAGE_OPTIONS` are the one-tap chips, not the only allowed values. */
  languages: string[];
  /** Bare national digits, like the sign-in screen — converted to E.164 only on save. */
  alternateNumber: string;
  emergencyName: string;
  emergencyNumber: string;
}

/** `"YYYY-MM-DD"` → a LOCAL `Date`. `new Date("YYYY-MM-DD")` parses as UTC and can land a day off. */
function fromDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** `+919876543210` → `9876543210`. Anything that is not a +91 mobile comes back untouched. */
function toNational(e164: string | null): string {
  if (e164 === null) return '';
  const digits = e164.replace(/^\+91/, '');
  return /^\d{10}$/.test(digits) ? digits : '';
}

function toForm(profile: CustomerProfileDto): Form {
  return {
    fullName: profile.full_name ?? '',
    gender: profile.gender,
    dob: profile.dob === null ? null : fromDateOnly(profile.dob),
    languages: [...profile.languages_known],
    alternateNumber: toNational(profile.alternate_number),
    emergencyName: profile.emergency_contact?.name ?? '',
    emergencyNumber: toNational(profile.emergency_contact?.number ?? null),
  };
}

/** Order-insensitive compare, so re-selecting the same chips is not counted as a change. */
function sameLanguages(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((entry) => set.has(entry));
}

export default function EditProfileScreen(): ReactElement {
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

  const [form, setForm] = useState<Form | null>(null);
  /** Which field owns the focus ring. One string key rather than a boolean now that there are many. */
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the form ONCE, when the profile first arrives. After that it is the customer's to edit —
  // a background refetch must not overwrite what they are typing.
  useEffect(() => {
    if (form === null && profile.data !== undefined) setForm(toForm(profile.data));
  }, [form, profile.data]);

  function patch(next: Partial<Form>): void {
    setForm((previous) => (previous === null ? previous : { ...previous, ...next }));
  }

  function clearFieldError(key: string): void {
    setFieldErrors((previous) => {
      if (previous[key] === undefined) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function toggleLanguage(language: string): void {
    setForm((previous) => {
      if (previous === null) return previous;
      const has = previous.languages.includes(language);
      return {
        ...previous,
        languages: has
          ? previous.languages.filter((entry) => entry !== language)
          : [...previous.languages, language],
      };
    });
  }

  /**
   * Validate the two phone fields and the emergency pair, returning the errors by field key.
   *
   * Kept separate from `buildBody` because it runs on save to BLOCK, while `buildBody` runs on
   * every keystroke to compute `dirty` and must never raise.
   */
  function validate(form: Form, original: CustomerProfileDto): Record<string, string> {
    const errors: Record<string, string> = {};

    const name = form.fullName.trim();
    if (name.length === 0 && (original.full_name ?? '') !== '') {
      errors['fullName'] = 'Your name cannot be removed.';
    } else if (name.length > 0 && name.length < 2) {
      errors['fullName'] = 'Enter your full name.';
    }

    if (form.alternateNumber.length > 0 && !isValidIndianMobile(form.alternateNumber)) {
      errors['alternateNumber'] = 'Enter a 10-digit mobile number.';
    }

    const emName = form.emergencyName.trim();
    const emNumber = form.emergencyNumber;
    // The contact is a pair: the server's `emergency_contact` object requires both a name and a
    // number, so half of one is not a saveable state — it is a prompt to finish or clear it.
    if (emName.length > 0 || emNumber.length > 0) {
      if (emName.length < 2) errors['emergencyName'] = "Enter the contact's name.";
      if (!isValidIndianMobile(emNumber)) {
        errors['emergencyNumber'] = 'Enter a 10-digit mobile number.';
      }
    }

    return errors;
  }

  /**
   * The PATCH body, BY DIFF: only fields that actually changed. `PATCH /customer/profile` reads
   * an absent key as "leave it" and an explicit `null` as "clear it", so unsetting the date,
   * gender, alternate number or emergency contact sends `null` while an unchanged field sends
   * nothing.
   *
   * Never raises — it is on the keystroke path for `dirty`. A field that is present but invalid
   * is simply left out here; `validate` is what stops the save.
   */
  function buildBody(original: CustomerProfileDto): UpdateCustomerProfileRequest | null {
    if (form === null) return null;
    const body: UpdateCustomerProfileRequest = {};

    const name = form.fullName.trim();
    if (name !== (original.full_name ?? '') && name.length >= 2) body.full_name = name;

    if (form.gender !== original.gender) body.gender = form.gender;

    const dob = form.dob === null ? null : toDateOnly(form.dob);
    if (dob !== (original.dob ?? null)) body.dob = dob;

    if (!sameLanguages(form.languages, original.languages_known)) {
      body.languages_known = form.languages;
    }

    const nextAlternate =
      form.alternateNumber.length === 0
        ? null
        : isValidIndianMobile(form.alternateNumber)
          ? toE164(form.alternateNumber)
          : undefined; // present but invalid — omit, `validate` blocks the save
    if (nextAlternate !== undefined && nextAlternate !== (original.alternate_number ?? null)) {
      body.alternate_number = nextAlternate;
    }

    const emName = form.emergencyName.trim();
    const emNumber = form.emergencyNumber;
    const nextContact = buildEmergencyContact(emName, emNumber);
    if (nextContact !== undefined && !sameContact(nextContact, original.emergency_contact)) {
      body.emergency_contact = nextContact;
    }

    return Object.keys(body).length === 0 ? null : body;
  }

  const save = useMutation({
    mutationFn: (body: UpdateCustomerProfileRequest) => updateProfile(body),
    onMutate: () => setSaveError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.profile.all() });
      router.back();
    },
    onError: (cause) => {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save your changes.');
    },
  });

  function handleSave(): void {
    if (profile.data === undefined || form === null) return;

    const errors = validate(form, profile.data);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const body = buildBody(profile.data);
    if (body === null) {
      router.back();
      return;
    }
    save.mutate(body);
  }

  const dirty = profile.data !== undefined && buildBody(profile.data) !== null;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit profile</Text>
        <View style={styles.back} />
      </View>

      {profile.isError ? (
        <View style={styles.centre}>
          <Text style={styles.loadError}>We could not load your profile.</Text>
          <Pressable
            onPress={() => void profile.refetch()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Feather name="refresh-cw" size={15} color={colors.fg} />
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : form === null ? (
        // Loading, or the one frame after data lands before the seed effect runs.
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={styles.flex}
          bottomOffset={24}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <FieldRow
            icon="user"
            label="Full name"
            focused={focusedField === 'fullName'}
            error={fieldErrors['fullName'] ?? null}
          >
            <TextInput
              value={form.fullName}
              onChangeText={(value) => {
                patch({ fullName: value });
                clearFieldError('fullName');
              }}
              onFocus={() => setFocusedField('fullName')}
              onBlur={() => setFocusedField(null)}
              placeholder="Enter your full name"
              placeholderTextColor={colors.faint}
              autoCapitalize="words"
              autoComplete="name"
              style={styles.input}
              accessibilityLabel="Full name"
            />
          </FieldRow>

          <FieldRow label="Gender" boxed={false}>
            <View style={styles.genderRow}>
              {GENDER_OPTIONS.map((option) => {
                const selected = form.gender === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => patch({ gender: selected ? null : option.value })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      styles.genderChip,
                      selected && styles.genderChipSelected,
                      pressed && !selected && styles.genderChipPressed,
                    ]}
                  >
                    <Text style={[styles.genderLabel, selected && styles.genderLabelSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FieldRow>

          <FieldRow icon="calendar" label="Date of birth">
            <View style={styles.triggerRow}>
              <Pressable
                onPress={() => setShowDatePicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Select your date of birth"
                style={styles.flex}
              >
                <Text style={form.dob === null ? styles.placeholder : styles.value}>
                  {form.dob === null ? 'Select date' : formatDob(form.dob)}
                </Text>
              </Pressable>
              {form.dob === null ? (
                <Feather name="chevron-right" size={18} color={colors.faint} />
              ) : (
                <Pressable
                  onPress={() => patch({ dob: null })}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear date of birth"
                >
                  <Feather name="x" size={16} color={colors.muted} />
                </Pressable>
              )}
            </View>
          </FieldRow>

          {/* SAFETY & CONTACT — the fields the server always stored but no screen ever offered.
              Grouped under their own heading because "who to call if something goes wrong" is a
              different thought from "who I am", and a customer scanning the form should be able
              to skip straight to it or straight past it. */}
          <View style={styles.sectionHeader}>
            <Feather name="shield" size={14} color={colors.muted} />
            <Text style={styles.sectionTitle}>Safety &amp; contact</Text>
          </View>

          <FieldRow
            label="Languages you speak"
            hint="(Optional)"
            boxed={false}
          >
            <View style={styles.chipWrap}>
              {LANGUAGE_OPTIONS.map((language) => {
                const selected = form.languages.includes(language);
                return (
                  <Pressable
                    key={language}
                    onPress={() => toggleLanguage(language)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    style={({ pressed }) => [
                      styles.langChip,
                      selected && styles.langChipSelected,
                      pressed && !selected && styles.genderChipPressed,
                    ]}
                  >
                    {selected ? (
                      <Feather
                        name="check"
                        size={13}
                        color={colors.fg}
                        style={styles.langChipTick}
                      />
                    ) : null}
                    <Text style={[styles.langLabel, selected && styles.genderLabelSelected]}>
                      {language}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FieldRow>

          <FieldRow
            icon="phone"
            label="Alternate mobile number"
            hint="(Optional)"
            focused={focusedField === 'alternateNumber'}
            error={fieldErrors['alternateNumber'] ?? null}
          >
            <View style={styles.phoneRow}>
              <Text style={styles.diallingCode}>{INDIA_DIALLING_CODE}</Text>
              <TextInput
                value={form.alternateNumber}
                onChangeText={(value) => {
                  patch({ alternateNumber: normaliseInput(value) });
                  clearFieldError('alternateNumber');
                }}
                onFocus={() => setFocusedField('alternateNumber')}
                onBlur={() => setFocusedField(null)}
                placeholder="98765 43210"
                placeholderTextColor={colors.faint}
                keyboardType="phone-pad"
                maxLength={10}
                style={styles.input}
                accessibilityLabel="Alternate mobile number"
              />
              {form.alternateNumber.length > 0 ? (
                <Pressable
                  onPress={() => {
                    patch({ alternateNumber: '' });
                    clearFieldError('alternateNumber');
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear alternate number"
                >
                  <Feather name="x" size={16} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
          </FieldRow>

          <FieldRow
            icon="user-check"
            label="Emergency contact name"
            hint="(Optional)"
            focused={focusedField === 'emergencyName'}
            error={fieldErrors['emergencyName'] ?? null}
          >
            <TextInput
              value={form.emergencyName}
              onChangeText={(value) => {
                patch({ emergencyName: value });
                clearFieldError('emergencyName');
              }}
              onFocus={() => setFocusedField('emergencyName')}
              onBlur={() => setFocusedField(null)}
              placeholder="Who should we call"
              placeholderTextColor={colors.faint}
              autoCapitalize="words"
              style={styles.input}
              accessibilityLabel="Emergency contact name"
            />
          </FieldRow>

          <FieldRow
            icon="phone-call"
            label="Emergency contact number"
            hint="(Optional)"
            focused={focusedField === 'emergencyNumber'}
            error={fieldErrors['emergencyNumber'] ?? null}
          >
            <View style={styles.phoneRow}>
              <Text style={styles.diallingCode}>{INDIA_DIALLING_CODE}</Text>
              <TextInput
                value={form.emergencyNumber}
                onChangeText={(value) => {
                  patch({ emergencyNumber: normaliseInput(value) });
                  clearFieldError('emergencyNumber');
                }}
                onFocus={() => setFocusedField('emergencyNumber')}
                onBlur={() => setFocusedField(null)}
                placeholder="98765 43210"
                placeholderTextColor={colors.faint}
                keyboardType="phone-pad"
                maxLength={10}
                style={styles.input}
                accessibilityLabel="Emergency contact number"
              />
              {form.emergencyNumber.length > 0 ? (
                <Pressable
                  onPress={() => {
                    patch({ emergencyNumber: '' });
                    clearFieldError('emergencyNumber');
                  }}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Clear emergency contact number"
                >
                  <Feather name="x" size={16} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
          </FieldRow>

          {saveError !== null ? (
            <Text style={styles.saveError} accessibilityLiveRegion="polite">
              {saveError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              label="Save changes"
              onPress={handleSave}
              loading={save.isPending}
              disabled={!dirty}
              showArrow={false}
            />
          </View>
        </KeyboardAwareScrollView>
      )}

      {showDatePicker && form !== null ? (
        <DateTimePicker
          value={form.dob ?? defaultDobAnchor()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(event, selected) => {
            setShowDatePicker(Platform.OS === 'ios');
            if (event.type === 'set' && selected !== undefined) patch({ dob: selected });
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * `{ name, number }` when both are filled, `null` when both are empty (a clear), `undefined` when
 * exactly one is filled — which is not a state the server accepts, so the caller omits it and
 * `validate` shows the error.
 */
function buildEmergencyContact(
  name: string,
  nationalNumber: string,
): EmergencyContactDto | null | undefined {
  const hasName = name.length > 0;
  const hasNumber = nationalNumber.length > 0;
  if (!hasName && !hasNumber) return null;
  if (hasName && hasNumber && name.length >= 2 && isValidIndianMobile(nationalNumber)) {
    return { name, number: toE164(nationalNumber) };
  }
  return undefined;
}

function sameContact(
  next: EmergencyContactDto | null,
  original: EmergencyContactDto | null,
): boolean {
  if (next === null || original === null) return next === original;
  return next.name === original.name && next.number === original.number;
}

/** Opens the wheel at a plausible adult birth year instead of today, which is never the answer. */
function defaultDobAnchor(): Date {
  const now = new Date();
  return new Date(now.getFullYear() - 25, now.getMonth(), now.getDate());
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg, flex: 1, textAlign: 'center' },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  loadError: { ...text.body, color: colors.muted, marginBottom: space.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryPressed: { backgroundColor: colors.bgSunken },
  retryLabel: { ...text.label, color: colors.fg },

  content: { paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.xl },

  input: { fontSize: 15, color: colors.fg, paddingVertical: 0, paddingHorizontal: 0, height: 52, flex: 1 },
  placeholder: { fontSize: 15, color: colors.faint },
  value: { fontSize: 15, color: colors.fg },
  triggerRow: { flexDirection: 'row', alignItems: 'center', height: 52 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  diallingCode: { ...text.body, color: colors.muted, fontFamily: fontFamily.semibold },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.md,
    marginBottom: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionTitle: {
    ...text.label,
    color: colors.muted,
    fontFamily: fontFamily.semibold,
  },

  genderRow: { flexDirection: 'row', gap: space.sm },
  genderChip: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderChipSelected: { backgroundColor: colors.brand, borderColor: colors.fg },
  genderChipPressed: { backgroundColor: colors.border },
  genderLabel: { ...text.body, color: colors.fg },
  genderLabelSelected: { fontWeight: '700', fontFamily: fontFamily.bold },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  langChip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  langChipSelected: { backgroundColor: colors.brand, borderColor: colors.fg },
  langChipTick: { marginRight: space.xs },
  langLabel: { ...text.body, color: colors.fg },

  saveError: { ...text.body, color: colors.danger, marginTop: space.sm, textAlign: 'center' },
  actions: { marginTop: space.lg },
});
