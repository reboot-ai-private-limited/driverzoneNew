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
import { Logo } from '@/components/Logo';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Skyline } from '@/components/Skyline';
import { WaveBottom } from '@/components/Wave';
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
      <Skyline height={280} />
      <WaveBottom height={116} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.logoBlock}>
            <Logo width={168} />
          </View>

          <Text style={styles.title}>Enter your mobile number</Text>
          <Text style={styles.subtitle}>
            We will send a 6-digit verification code to confirm it is you.
          </Text>

          <Text style={styles.fieldLabel}>Mobile number</Text>
          <View
            style={[
              styles.field,
              focused && styles.fieldFocused,
              error !== null && styles.fieldError,
            ]}
          >
            {/* Fixed at +91 for now. A `View` rather than a disabled picker, because a control
                that opens nothing is worse than no control — the second country arrives with
                the market that needs it. */}
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
              maxLength={10}
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

          {/* Pushes the legal line to the foot of the screen on a tall device and collapses on a
              short one, so it never floats mid-screen. */}
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

  logoBlock: { alignItems: 'center', marginTop: space.xl, marginBottom: space.xl },

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

  legal: {
    ...text.caption,
    // Ink rather than `muted`: the bottom of the screen is the yellow wave, and grey on yellow
    // falls under 4.5:1 at this size.
    color: colors.fg,
    textAlign: 'center',
    marginBottom: space.lg,
  },
  legalLink: { color: colors.link },
});
