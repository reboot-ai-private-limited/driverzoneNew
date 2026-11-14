import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import type { UpdateCustomerProfileRequest } from '@driverzone/contracts';
import { FieldRow } from '@/components/FieldRow';
import { Logo } from '@/components/Logo';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressRing } from '@/components/ProgressRing';
import { WaveHeaderEdge } from '@/components/Wave';
import {
  EMPTY_DRAFT,
  GENDER_OPTIONS,
  type ProfileDraft,
  completionPercent,
  formatDob,
  toDateOnly,
} from '@/features/profile/completion';
import { updateProfile } from '@/lib/api/endpoints/customer';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

const MIN_NAME_LENGTH = 2;

/**
 * Where a brand-new account lands, straight after `otp/verify`, and where a signed-in account
 * with no name is sent back to.
 *
 * NAME IS REQUIRED — it is what the driver is told to ask for at pickup. Gender and date of birth
 * are optional and can be left blank. Every field shown here is one `PATCH /customer/profile`
 * actually stores: a field the server would drop (photo, email, payment method, address) is not
 * collected at all, rather than collected and silently thrown away.
 */
export default function ProfileSetupScreen(): ReactElement {
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [focused, setFocused] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function patch(next: Partial<ProfileDraft>): void {
    setDraft((previous) => ({ ...previous, ...next }));
  }

  const percent = completionPercent(draft);
  const name = draft.fullName.trim();
  const nameValid = name.length >= MIN_NAME_LENGTH;

  /** Builds the PATCH body BY OMISSION — an absent key leaves the stored value alone. */
  const save = useMutation({
    mutationFn: async () => {
      const body: UpdateCustomerProfileRequest = { full_name: name };
      if (draft.gender !== null) body.gender = draft.gender;
      if (draft.dob !== null) body.dob = toDateOnly(draft.dob);
      return updateProfile(body);
    },
    onMutate: () => setSaveError(null),
    onSuccess: () => router.replace('/home'),
    onError: (cause) => {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save your profile.');
    },
  });

  function handleSave(): void {
    if (!nameValid) {
      setNameError('Enter your full name.');
      return;
    }
    setNameError(null);
    save.mutate();
  }

  return (
    <View style={styles.root}>
      <KeyboardAwareScrollView
        style={styles.flex}
        bottomOffset={24}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerLogo}>
            <Logo width={150} />
          </View>
        </View>

        <WaveHeaderEdge height={40} />

        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>Complete your profile</Text>
            <Text style={styles.subtitle}>
              Your name is needed so your driver knows who to meet. Everything else is optional.
            </Text>
          </View>
          <ProgressRing percent={percent} size={72} strokeWidth={6} />
        </View>

        <View style={styles.form}>
          <FieldRow icon="user" label="Full name (required)" focused={focused} error={nameError}>
            <TextInput
              value={draft.fullName}
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
              textContentType="name"
              returnKeyType="done"
              style={styles.input}
              accessibilityLabel="Full name, required"
            />
          </FieldRow>

          <FieldRow label="Gender (optional)" boxed={false}>
            <View style={styles.genderRow}>
              {GENDER_OPTIONS.map((option) => {
                const selected = draft.gender === option.value;
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

          <FieldRow icon="calendar" label="Date of birth (optional)">
            <Pressable
              onPress={() => setShowDatePicker(true)}
              accessibilityRole="button"
              accessibilityLabel="Select your date of birth"
              style={styles.triggerRow}
            >
              <Text style={draft.dob === null ? styles.placeholder : styles.value}>
                {draft.dob === null ? 'Select date' : formatDob(draft.dob)}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.faint} />
            </Pressable>
          </FieldRow>

          {saveError !== null ? (
            <Text style={styles.saveError} accessibilityLiveRegion="polite">
              {saveError}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              label="Save & Continue"
              onPress={handleSave}
              loading={save.isPending}
              disabled={!nameValid}
            />
          </View>
        </View>
      </KeyboardAwareScrollView>

      {showDatePicker ? (
        <DateTimePicker
          value={draft.dob ?? defaultDobAnchor()}
          mode="date"
          // A wheel rather than a calendar grid: picking a birth year 30 years back is many taps
          // of a month-by-month calendar and one flick of a wheel.
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={new Date()}
          onChange={(event, selected) => {
            // The non-iOS picker fires with type 'dismissed' on cancel and unmounts itself.
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
  scrollContent: { paddingBottom: space.lg },

  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
  },
  headerLogo: { flex: 1, alignItems: 'center' },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
  },
  title: { ...text.title, color: colors.fg },
  subtitle: { ...text.body, color: colors.muted, marginTop: space.xs, paddingRight: space.md },

  form: { paddingHorizontal: space.lg },

  input: { fontSize: 15, color: colors.fg, paddingVertical: 0, paddingHorizontal: 0, height: 52 },
  placeholder: { fontSize: 15, color: colors.faint },
  value: { fontSize: 15, color: colors.fg },
  triggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
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

  saveError: { ...text.body, color: colors.danger, marginTop: space.sm, textAlign: 'center' },

  actions: { marginTop: space.lg },
});
