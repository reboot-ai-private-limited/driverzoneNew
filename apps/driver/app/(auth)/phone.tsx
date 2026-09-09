import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Logo } from '@/components/Logo';
import { isValidIndianMobile, normaliseInput, toE164 } from '@/features/auth/phoneNumber';
import { sendOtp } from '@/lib/api/endpoints/auth';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * Step one of two. Collects a mobile number and asks the server to send a code.
 *
 * There is no "is this number registered" branch, and there cannot be: `otp/send` answers
 * identically for a known and an unknown number, because a reply that differed would let anyone
 * enumerate which numbers have accounts (docs/LLD/auth.md). Sign-in and sign-up are therefore
 * the same screen — which is also why nothing here is worded as either.
 */
export default function PhoneScreen(): ReactElement {
  const [national, setNational] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isValidIndianMobile(national);

  const mutation = useMutation({
    mutationFn: (mobile: string) => sendOtp({ mobile_number: mobile }),
    onMutate: () => setError(null),
    onSuccess: (result, mobile) => {
      // `retry_after_seconds` rides along to the next screen so its resend countdown starts from
      // the server's cooldown rather than a number this app invented.
      router.push({
        pathname: '/otp',
        params: { mobile, retryAfter: String(result.retry_after_seconds) },
      });
    },
    onError: (cause) => {
      // The server's wording, verbatim — never copy built from `code`. A reason added
      // server-side has to render correctly on a build that predates it.
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    },
  });

  function handleContinue(): void {
    if (!valid) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    mutation.mutate(toE164(national));
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Logo width={200} showBadge />
        <Text style={styles.tagline}>Drive with DriverZone</Text>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Enter your mobile number</Text>
          <Text style={styles.subtitle}>
            We will send a 6-digit verification code to confirm it is you.
          </Text>

          <Text style={styles.fieldLabel}>Mobile number</Text>
          <View
            style={[styles.field, focused && styles.fieldFocused, error !== null && styles.fieldError]}
          >
            {/* Fixed at +91 for now. A `View` rather than a disabled picker, because a control
                that opens nothing is worse than no control — the second country arrives with the
                market that needs it. */}
            <View style={styles.dialCode}>
              <Text style={styles.flag}>{'\u{1F1EE}\u{1F1F3}'}</Text>
              <Text style={styles.dialCodeText}>+91</Text>
              <Feather name="chevron-down" size={16} color={colors.faint} />
            </View>
            <View style={styles.fieldDivider} />
            <TextInput
              value={national}
              onChangeText={(raw) => {
                setNational(normaliseInput(raw));
                if (error !== null) setError(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="00000 00000"
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              /*
               * ROOM FOR A COUNTRY CODE THAT IS ABOUT TO BE STRIPPED, not for a longer number.
               * `normaliseInput` returns at most ten digits and `value` is bound to its result, so
               * the field can never actually display more than that.
               *
               * At 10 this silently broke: a driver typing `919876543210` had the input capped
               * before `normaliseInput` could see the `91` to remove, leaving `9198765432` — ten
               * digits, valid-looking, and the wrong person's number. The cap has to sit above
               * the longest thing someone might paste, not at the length of the answer.
               */
              maxLength={16}
              style={styles.input}
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              accessibilityLabel="Mobile number"
            />
          </View>

          {error !== null ? (
            <Text style={styles.errorText} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <View style={styles.buttonBlock}>
            <PrimaryButton
              label="Continue"
              onPress={handleContinue}
              loading={mutation.isPending}
              disabled={!valid}
            />
          </View>

          {/* Pushes the legal line to the foot of a tall screen and collapses on a short one, so
              it never floats mid-screen. */}
          <View style={styles.spacer} />

          <Text style={styles.legal}>
            By continuing, you agree to our{' '}
            <Text style={styles.legalLink}>Terms &amp; Conditions</Text> and{' '}
            <Text style={styles.legalLink}>Privacy Policy</Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, flexGrow: 1 },

  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingTop: space.xl,
    paddingBottom: space.xl,
    alignItems: 'center',
    marginBottom: space.xl,
  },
  tagline: { ...text.body, color: colors.fg, opacity: 0.8, marginTop: space.sm },

  title: { ...text.title, color: colors.fg },
  subtitle: { ...text.body, color: colors.muted, marginTop: space.sm, marginBottom: space.xl },

  fieldLabel: { ...text.label, color: colors.muted, marginBottom: space.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: 56,
  },
  // A visible focus ring, not just a caret: on a single-field screen the border is the only cue
  // that the keyboard is aimed here.
  fieldFocused: { borderColor: colors.fg, backgroundColor: colors.card },
  fieldError: { borderColor: colors.danger, backgroundColor: colors.card },
  dialCode: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md },
  flag: { fontSize: 18, marginRight: 6 },
  dialCodeText: {
    ...text.body,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
    color: colors.fg,
    marginRight: 4,
  },
  fieldDivider: { width: 1, height: '60%', backgroundColor: colors.border },
  input: {
    flex: 1,
    paddingHorizontal: space.md,
    fontSize: 17,
    letterSpacing: 1,
    color: colors.fg,
    height: '100%',
  },

  errorText: { ...text.caption, color: colors.danger, marginTop: space.sm },
  buttonBlock: { marginTop: space.lg },

  spacer: { flex: 1, minHeight: space.xl },
  legal: { ...text.caption, color: colors.muted, textAlign: 'center', marginBottom: space.lg },
  legalLink: { color: colors.link },
});
