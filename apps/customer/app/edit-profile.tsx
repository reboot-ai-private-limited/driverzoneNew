import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useState } from 'react';
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
import type {
  CustomerProfileDto,
  Gender,
  UpdateCustomerProfileRequest,
} from '@driverzone/contracts';
import { FieldRow } from '@/components/FieldRow';
import { PrimaryButton } from '@/components/PrimaryButton';
import { GENDER_OPTIONS, formatDob, toDateOnly } from '@/features/profile/completion';
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
 * Scope is the three fields `PATCH /customer/profile` persists AND this app already collects:
 * `full_name`, `gender`, `dob`. Alternate number and emergency contact are in the contract too
 * but have no screen anywhere yet — they belong to their own "Safety" section, not here.
 */

interface Form {
  fullName: string;
  gender: Gender | null;
  dob: Date | null;
}

/** `"YYYY-MM-DD"` → a LOCAL `Date`. `new Date("YYYY-MM-DD")` parses as UTC and can land a day off. */
function fromDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function toForm(profile: CustomerProfileDto): Form {
  return {
    fullName: profile.full_name ?? '',
    gender: profile.gender,
    dob: profile.dob === null ? null : fromDateOnly(profile.dob),
  };
}

export default function EditProfileScreen(): ReactElement {
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

  const [form, setForm] = useState<Form | null>(null);
  const [focused, setFocused] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Seed the form ONCE, when the profile first arrives. After that it is the customer's to edit —
  // a background refetch must not overwrite what they are typing.
  useEffect(() => {
    if (form === null && profile.data !== undefined) setForm(toForm(profile.data));
  }, [form, profile.data]);

  function patch(next: Partial<Form>): void {
    setForm((previous) => (previous === null ? previous : { ...previous, ...next }));
  }

  /**
   * The PATCH body, BY DIFF: only fields that actually changed. `PATCH /customer/profile` reads
   * an absent key as "leave it" and an explicit `null` as "clear it", so unsetting the date or
   * gender sends `null` while an unchanged field sends nothing.
   */
  function buildBody(original: CustomerProfileDto): UpdateCustomerProfileRequest | null {
    if (form === null) return null;
    const body: UpdateCustomerProfileRequest = {};

    const name = form.fullName.trim();
    if (name !== (original.full_name ?? '') && name.length >= 2) body.full_name = name;

    if (form.gender !== original.gender) body.gender = form.gender;

    const dob = form.dob === null ? null : toDateOnly(form.dob);
    if (dob !== (original.dob ?? null)) body.dob = dob;

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

    const name = form.fullName.trim();
    // The contract has no way to clear a name — only to set one — so an empty field is only
    // valid when the profile had no name to begin with.
    if (name.length === 0 && (profile.data.full_name ?? '') !== '') {
      setNameError('Your name cannot be removed.');
      return;
    }
    if (name.length > 0 && name.length < 2) {
      setNameError('Enter your full name.');
      return;
    }
    setNameError(null);

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
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FieldRow icon="user" label="Full name" focused={focused} error={nameError}>
              <TextInput
                value={form.fullName}
                onChangeText={(value) => {
                  patch({ fullName: value });
                  if (nameError !== null) setNameError(null);
                }}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
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
          </ScrollView>
        </KeyboardAvoidingView>
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

  input: { fontSize: 15, color: colors.fg, paddingVertical: 0, paddingHorizontal: 0, height: 52 },
  placeholder: { fontSize: 15, color: colors.faint },
  value: { fontSize: 15, color: colors.fg },
  triggerRow: { flexDirection: 'row', alignItems: 'center', height: 52 },

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

  saveError: { ...text.body, color: colors.danger, marginTop: space.sm, textAlign: 'center' },
  actions: { marginTop: space.lg },
});
