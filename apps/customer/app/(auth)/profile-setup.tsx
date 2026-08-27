import { Feather } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { type ReactElement, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UpdateCustomerProfileRequest } from '@driverzone/contracts';
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
import { colors, radius, shadow, space, text } from '@/theme/theme';

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
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<ProfileDraft>(EMPTY_DRAFT);
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
              <Logo width={170} />
            </View>
            {/* Balances the back button so the logo stays optically centred. */}
            <View style={styles.back} />
          </View>

          <WaveHeaderEdge height={40} />

          <View style={styles.titleRow}>
            <View style={styles.flex}>
              <Text style={styles.title}>Complete Your Profile</Text>
              <Text style={styles.subtitle}>Help us serve you better</Text>
            </View>
            <ProgressRing percent={percent} />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionLabel}>
              Profile Photo <Text style={styles.sectionHint}>(Optional)</Text>
            </Text>

            <View style={styles.avatarBlock}>
              <Pressable
                onPress={() => void pickPhoto()}
                accessibilityRole="button"
                accessibilityLabel={draft.photoUri === null ? 'Add a profile photo' : 'Change your profile photo'}
                style={styles.avatarPress}
              >
                {draft.photoUri === null ? (
                  <View style={styles.avatarPlaceholder}>
                    <Feather name="user" size={44} color={colors.faint} />
                  </View>
                ) : (
                  <Image source={{ uri: draft.photoUri }} style={styles.avatar} />
                )}
                <View style={styles.cameraBadge}>
                  <Feather name="camera" size={15} color={colors.fg} />
                </View>
              </Pressable>
            </View>

            <FieldRow icon="user" label="Full Name" required error={nameError}>
              <TextInput
                value={draft.fullName}
                onChangeText={(value) => {
                  patch({ fullName: value });
                  if (nameError !== null) setNameError(null);
                }}
                placeholder="Enter your full name"
                placeholderTextColor={colors.faint}
                autoCapitalize="words"
                autoComplete="name"
                style={styles.input}
                accessibilityLabel="Full name"
              />
            </FieldRow>

            <FieldRow icon="users" label="Gender">
              <View style={styles.genderRow}>
                {GENDER_OPTIONS.map((option) => {
                  const selected = draft.gender === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      onPress={() => patch({ gender: selected ? null : option.value })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      style={[styles.genderChip, selected && styles.genderChipSelected]}
                    >
                      <Text style={[styles.genderLabel, selected && styles.genderLabelSelected]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </FieldRow>

            <FieldRow icon="calendar" label="Date of Birth" hint="(Optional)">
              <Pressable
                onPress={() => setShowDatePicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Select your date of birth"
                style={styles.triggerRow}
              >
                <Text style={draft.dob === null ? styles.placeholder : styles.value}>
                  {draft.dob === null ? 'Select your date of birth' : formatDob(draft.dob)}
                </Text>
                <Feather name="calendar" size={18} color={colors.muted} />
              </Pressable>
            </FieldRow>

            <FieldRow icon="mail" label="Email" hint="(Optional)" error={emailError}>
              <TextInput
                value={draft.email}
                onChangeText={(value) => {
                  patch({ email: value });
                  if (emailError !== null) setEmailError(null);
                }}
                placeholder="Enter your email address"
                placeholderTextColor={colors.faint}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                style={styles.input}
                accessibilityLabel="Email address"
              />
            </FieldRow>

            <FieldRow icon="credit-card" label="Preferred Payment Method">
              <Pressable
                onPress={() => setShowPaymentSheet(true)}
                accessibilityRole="button"
                accessibilityLabel="Select your preferred payment method"
                style={styles.triggerRow}
              >
                <Text style={selectedPayment === undefined ? styles.placeholder : styles.value}>
                  {selectedPayment?.label ?? 'Select your preferred payment method'}
                </Text>
                <Feather name="chevron-down" size={18} color={colors.muted} />
              </Pressable>
            </FieldRow>

            <FieldRow icon="map-pin" label="Current Address" hint="(Optional)">
              <View style={styles.triggerRow}>
                <TextInput
                  value={draft.address}
                  onChangeText={(value) => patch({ address: value })}
                  placeholder="Enter your current address"
                  placeholderTextColor={colors.faint}
                  style={[styles.input, styles.flex]}
                  accessibilityLabel="Current address"
                />
              </View>
            </FieldRow>

            <View style={styles.notice}>
              <View style={styles.noticeIcon}>
                <Feather name="info" size={14} color={colors.fg} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.noticeTitle}>
                  You can edit your profile anytime from Profile Settings.
                </Text>
                <Text style={styles.noticeBody}>
                  Completing your profile helps us personalize your experience.
                </Text>
              </View>
            </View>

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
                style={({ pressed }) => [styles.skipButton, pressed && styles.skipPressed]}
              >
                <Text style={styles.skipLabel}>Skip for Now</Text>
              </Pressable>
            </View>

            <View style={styles.assurance}>
              <Feather name="lock" size={14} color={colors.muted} />
              <Text style={styles.assuranceText}>Your information is safe and secure with us.</Text>
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

      <Modal
        visible={showPaymentSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPaymentSheet(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowPaymentSheet(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
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
                  style={styles.sheetOption}
                >
                  <Text style={styles.sheetOptionLabel}>{method.label}</Text>
                  {selected ? <Feather name="check" size={18} color={colors.fg} /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
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
  scrollContent: { paddingBottom: space.xl },

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
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  title: { ...text.display, color: colors.fg },
  subtitle: { ...text.body, color: colors.muted, marginTop: 2 },

  card: {
    marginHorizontal: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.md,
    ...shadow.card,
  },
  sectionLabel: { ...text.label, fontSize: 14, color: colors.fg },
  sectionHint: { color: colors.faint, fontWeight: '400' },

  avatarBlock: { alignItems: 'center', marginTop: space.sm, marginBottom: space.md },
  avatarPress: { width: 104, height: 104 },
  avatar: { width: 104, height: 104, borderRadius: radius.pill },
  avatarPlaceholder: {
    width: 104,
    height: 104,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 6,
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },

  input: { fontSize: 15, color: colors.fg, paddingVertical: 4, paddingHorizontal: 0 },
  placeholder: { fontSize: 15, color: colors.faint },
  value: { fontSize: 15, color: colors.fg },
  triggerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  genderRow: { flexDirection: 'row', marginTop: 4 },
  genderChip: {
    flex: 1,
    marginRight: 6,
    height: 38,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  genderChipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  genderLabel: { ...text.body, color: colors.fg },
  genderLabelSelected: { fontWeight: '700' },

  notice: {
    flexDirection: 'row',
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.sm,
  },
  noticeIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  noticeTitle: { ...text.label, fontSize: 13.5, color: colors.fg },
  noticeBody: { ...text.caption, color: colors.muted, marginTop: 2 },

  saveError: { ...text.body, color: colors.danger, marginTop: space.md, textAlign: 'center' },

  actions: { marginTop: space.lg },
  skipButton: {
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  skipPressed: { backgroundColor: colors.bgSunken },
  skipLabel: { ...text.body, fontWeight: '600', color: colors.fg },

  assurance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
  },
  assuranceText: { ...text.caption, color: colors.muted, marginLeft: 6 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  sheetTitle: { ...text.heading, color: colors.fg, marginBottom: space.sm },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sheetOptionLabel: { ...text.body, color: colors.fg },
});
