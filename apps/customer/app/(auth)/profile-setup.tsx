import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { type ReactElement, useState } from 'react';
import {
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
import type { UpdateCustomerProfileRequest } from '@driverzone/contracts';
import { BottomSheet } from '@/components/BottomSheet';
import { FieldRow } from '@/components/FieldRow';
import { Logo } from '@/components/Logo';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ProgressRing } from '@/components/ProgressRing';
import { WaveHeaderEdge } from '@/components/Wave';
import {
  EMPTY_DRAFT,
  GENDER_OPTIONS,
  PAYMENT_METHODS,
  type ProfileDraft,
  completionPercent,
  formatDob,
  isPlausibleEmail,
  toDateOnly,
} from '@/features/profile/completion';
import { updateProfile } from '@/lib/api/endpoints/customer';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/** Which field owns the focus ring. One at a time, so the screen holds a single value. */
type FocusTarget = 'name' | 'email' | 'address' | null;

/**
 * Where a brand-new account lands, straight after `otp/verify` returned `is_new_user: true`.
 *
 * **Only three of these fields reach the server today.** `PATCH /customer/profile` accepts
 * `full_name`, `gender` and `dob` (plus languages and emergency contact, which this screen does
 * not collect). Photo, email, payment method and address have no endpoint yet — see the note
 * above `handleSave`. They are collected and held in form state so the screen matches the
 * approved design, and the save reports honestly what it stored.
 *
 * Everything here is skippable, including the name. A customer account is created holding
 * nothing but a phone number and no endpoint ever requires more (docs/LLD/user.md §Customer) —
 * profiles complete progressively, so a wall here would be a wall we invented.
 */
export default function ProfileSetupScreen(): ReactElement {
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
  const [focus, setFocus] = useState<FocusTarget>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPaymentSheet, setShowPaymentSheet] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function patch(next: Partial<ProfileDraft>): void {
    setDraft((previous) => ({ ...previous, ...next }));
  }

  const percent = completionPercent(draft);

  async function pickPhoto(): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      // Square, because every surface that shows an avatar crops it to a circle.
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0] !== undefined) {
      patch({ photoUri: result.assets[0].uri });
    }
  }

  /**
   * Builds the PATCH body BY OMISSION.
   *
   * `PATCH /customer/profile` treats an absent key as "leave it alone" and an explicit `null` as
   * "clear it" — genuinely different intents (docs/LLD/user.md). Sending every field on every
   * save would erase whatever the customer left blank here, which on a re-entry to this screen
   * would wipe data they entered elsewhere.
   */
  const save = useMutation({
    mutationFn: async () => {
      const body: UpdateCustomerProfileRequest = {};
      const name = draft.fullName.trim();
      if (name.length > 0) body.full_name = name;
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
    const name = draft.fullName.trim();
    if (name.length > 0 && name.length < 2) {
      setNameError('Enter your full name.');
      return;
    }
    if (draft.email.trim().length > 0 && !isPlausibleEmail(draft.email)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setNameError(null);
    setEmailError(null);
    save.mutate();
  }

  const selectedPayment = PAYMENT_METHODS.find((method) => method.value === draft.paymentMethod);

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
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
            <View style={styles.headerLogo}>
              <Logo width={150} />
            </View>
            {/* Balances the back button so the logo stays optically centred. */}
            <View style={styles.back} />
          </View>

          <WaveHeaderEdge height={40} />

          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <Text style={styles.title}>Complete your profile</Text>
              <Text style={styles.subtitle}>All of this is optional — skip anything you like.</Text>
            </View>
            <ProgressRing percent={percent} size={72} strokeWidth={6} />
          </View>

          <View style={styles.form}>
            <View style={styles.avatarBlock}>
              <Pressable
                onPress={() => void pickPhoto()}
                accessibilityRole="button"
                accessibilityLabel={
                  draft.photoUri === null ? 'Add a profile photo' : 'Change your profile photo'
                }
                style={({ pressed }) => [styles.avatarPress, pressed && styles.pressedDim]}
              >
                {draft.photoUri === null ? (
                  <View style={styles.avatarPlaceholder}>
                    <Feather name="user" size={38} color={colors.faint} />
                  </View>
                ) : (
                  <Image source={{ uri: draft.photoUri }} style={styles.avatar} />
                )}
                <View style={styles.cameraBadge}>
                  <Feather name="camera" size={14} color={colors.fg} />
                </View>
              </Pressable>
              <Text style={styles.avatarCaption}>
                {draft.photoUri === null ? 'Add a photo' : 'Change photo'}
              </Text>
            </View>

            <FieldRow icon="user" label="Full name" focused={focus === 'name'} error={nameError}>
              <TextInput
                value={draft.fullName}
                onChangeText={(value) => {
                  patch({ fullName: value });
                  if (nameError !== null) setNameError(null);
                }}
                onFocus={() => setFocus('name')}
                onBlur={() => setFocus(null)}
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

            <FieldRow icon="calendar" label="Date of birth">
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

            <FieldRow icon="mail" label="Email" focused={focus === 'email'} error={emailError}>
              <TextInput
                value={draft.email}
                onChangeText={(value) => {
                  patch({ email: value });
                  if (emailError !== null) setEmailError(null);
                }}
                onFocus={() => setFocus('email')}
                onBlur={() => setFocus(null)}
                placeholder="you@example.com"
                placeholderTextColor={colors.faint}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
                accessibilityLabel="Email address"
              />
            </FieldRow>

            <FieldRow icon="credit-card" label="Preferred payment method">
              <Pressable
                onPress={() => setShowPaymentSheet(true)}
                accessibilityRole="button"
                accessibilityLabel="Select your preferred payment method"
                style={styles.triggerRow}
              >
                <Text style={selectedPayment === undefined ? styles.placeholder : styles.value}>
                  {selectedPayment?.label ?? 'Select method'}
                </Text>
                <Feather name="chevron-down" size={18} color={colors.faint} />
              </Pressable>
            </FieldRow>

            <FieldRow icon="map-pin" label="Current address" focused={focus === 'address'}>
              <TextInput
                value={draft.address}
                onChangeText={(value) => patch({ address: value })}
                onFocus={() => setFocus('address')}
                onBlur={() => setFocus(null)}
                placeholder="House, street, area"
                placeholderTextColor={colors.faint}
                style={styles.input}
                accessibilityLabel="Current address"
              />
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
              />

              <Pressable
                onPress={() => router.replace('/home')}
                accessibilityRole="button"
                disabled={save.isPending}
                hitSlop={8}
                style={styles.skipButton}
              >
                <Text style={styles.skipLabel}>Skip for now</Text>
              </Pressable>
            </View>
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

      {/*
        `BottomSheet`, not a `Modal` with `animationType="slide"`. That prop animates the whole
        modal window, backdrop included, so the dark scrim flew up from the bottom edge with the
        panel. The backdrop has to fade in place while only the panel travels — see the component.
      */}
      <BottomSheet visible={showPaymentSheet} onClose={() => setShowPaymentSheet(false)}>
        <Text style={styles.sheetTitle}>Preferred payment method</Text>
        {PAYMENT_METHODS.map((method) => {
          const selected = draft.paymentMethod === method.value;
          return (
            <Pressable
              key={method.value}
              onPress={() => {
                patch({ paymentMethod: method.value });
                setShowPaymentSheet(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={({ pressed }) => [styles.sheetOption, pressed && styles.sheetOptionPressed]}
            >
              <Text style={[styles.sheetOptionLabel, selected && styles.sheetOptionSelected]}>
                {method.label}
              </Text>
              {selected ? <Feather name="check" size={18} color={colors.fg} /> : null}
            </Pressable>
          );
        })}
      </BottomSheet>
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
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
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

  // A plain page section, not a raised card: a white card on a white page is a shadow with
  // nothing behind it, and it cost 16pt of inset on both edges.
  form: { paddingHorizontal: space.lg },

  avatarBlock: { alignItems: 'center', marginBottom: space.lg },
  avatarPress: { width: 92, height: 92 },
  pressedDim: { opacity: 0.85 },
  avatar: { width: 92, height: 92, borderRadius: radius.pill },
  avatarPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 2,
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  avatarCaption: { ...text.caption, color: colors.muted, marginTop: space.sm },

  input: { fontSize: 15, color: colors.fg, paddingVertical: 0, paddingHorizontal: 0, height: 52 },
  placeholder: { fontSize: 15, color: colors.faint },
  value: { fontSize: 15, color: colors.fg },
  triggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
  },

  // `gap` rather than a margin on each chip: a trailing margin leaves the row 8pt short of the
  // right edge and out of line with every field above it.
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

  actions: { marginTop: space.md },
  skipButton: { alignItems: 'center', paddingVertical: space.md, marginTop: space.xs },
  skipLabel: { ...text.body, color: colors.link },

  sheetTitle: { ...text.heading, color: colors.fg, marginBottom: space.sm },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sheetOptionPressed: { backgroundColor: colors.bgSunken },
  sheetOptionLabel: { ...text.body, color: colors.fg },
  sheetOptionSelected: { fontWeight: '700', fontFamily: fontFamily.bold },
});
