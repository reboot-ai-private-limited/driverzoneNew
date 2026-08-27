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
import { colors, radius, shadow, space, text } from '@/theme/theme';

/**
 * Step one of two. Collects a mobile number and asks the server to send a code.
 *
 * There is no "is this number registered" branch, and there cannot be: `otp/send` answers
 * identically for a known and an unknown number, because a reply that differed would let anyone
 * enumerate which numbers have accounts (docs/LLD/auth.md). Sign-in and sign-up are the same
 * screen, which is also why the heading says "Login or sign up".
 */
export default function PhoneScreen(): ReactElement {
  const [national, setNational] = useState('');
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
      <WaveBottom height={130} />

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
            <Logo width={230} />
          </View>

          <Text style={styles.welcome}>Welcome to</Text>
          <Text style={styles.brandName}>Driver Zone</Text>
          <Text style={styles.tagline}>Login or sign up to book{'\n'}professional drivers</Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Enter your mobile number</Text>
            <Text style={styles.cardSub}>We will send you a verification code</Text>

            <View style={[styles.field, error !== null && styles.fieldError]}>
              {/* Fixed at +91 for now. A `View` rather than a disabled picker, because a control
                  that opens nothing is worse than no control — the second country arrives with
                  the market that needs it. */}
              <View style={styles.dialCode}>
                <Text style={styles.flag}>{'\u{1F1EE}\u{1F1F3}'}</Text>
                <Text style={styles.dialCodeText}>+91</Text>
                <Feather name="chevron-down" size={16} color={colors.muted} />
              </View>
              <View style={styles.fieldDivider} />
              <TextInput
                value={national}
                onChangeText={(raw) => {
                  setNational(normaliseInput(raw));
                  if (error !== null) setError(null);
                }}
                placeholder="Enter mobile number"
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
          </View>

          <View style={styles.assurances}>
            <Assurance icon="shield" title={'Safe & Secure'} body={'Your data is\nprotected'} />
            <Assurance icon="thumbs-up" title="Easy Booking" body={'Book in just a few\ntaps'} />
            <Assurance icon="clock" title="24/7 Support" body={'We are always\nhere'} />
          </View>

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

function Assurance({
  icon,
  title,
  body,
}: {
  icon: 'shield' | 'thumbs-up' | 'clock';
  title: string;
  body: string;
}): ReactElement {
  return (
    <View style={styles.assurance}>
      <View style={styles.assuranceIcon}>
        <Feather name={icon} size={20} color={colors.fg} />
      </View>
      <Text style={styles.assuranceTitle}>{title}</Text>
      <Text style={styles.assuranceBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: space.lg, flexGrow: 1 },

  logoBlock: { alignItems: 'center', marginBottom: space.xl },
  welcome: { ...text.title, fontWeight: '400', color: colors.fg },
  brandName: { ...text.display, color: colors.fg, marginBottom: space.sm },
  tagline: { ...text.body, color: colors.muted, marginBottom: space.lg },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    ...shadow.card,
  },
  cardTitle: { ...text.heading, color: colors.fg },
  cardSub: { ...text.body, color: colors.muted, marginTop: 2, marginBottom: space.md },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    height: 56,
  },
  fieldError: { borderColor: colors.danger },
  dialCode: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md },
  flag: { fontSize: 18, marginRight: 6 },
  dialCodeText: { ...text.body, fontWeight: '600', color: colors.fg, marginRight: 4 },
  fieldDivider: { width: 1, height: '60%', backgroundColor: colors.border },
  input: { flex: 1, paddingHorizontal: space.md, fontSize: 16, color: colors.fg, height: '100%' },

  errorText: { ...text.caption, color: colors.danger, marginTop: space.sm },
  buttonBlock: { marginTop: space.md },

  assurances: { flexDirection: 'row', marginTop: space.xl },
  assurance: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  assuranceIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  assuranceTitle: { ...text.label, color: colors.fg, textAlign: 'center' },
  assuranceBody: { ...text.caption, color: colors.muted, textAlign: 'center', marginTop: 2 },

  legal: {
    ...text.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xl,
    marginBottom: space.xl,
  },
  legalLink: { color: colors.link },
});
