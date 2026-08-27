import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Logo } from '@/components/Logo';
import { OtpInput } from '@/components/OtpInput';
import { WaveHeaderEdge } from '@/components/Wave';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { ApiError } from '@/lib/api/ApiError';
import { sendOtp, verifyOtp } from '@/lib/api/endpoints/auth';
import * as session from '@/lib/auth/session';
import { colors, radius, shadow, space, text } from '@/theme/theme';

const OTP_LENGTH = 6;

/**
 * Step two of two. Verifies the code and starts the session.
 *
 * The resend countdown is driven ENTIRELY by the server's `retry_after_seconds` — carried in
 * from the previous screen, then refreshed by each resend. The per-phone cooldown lives in
 * `SendOtpUseCase`, so a client-side timer of its own invention would either let the customer
 * tap into a guaranteed rejection or hold them back longer than the server actually requires.
 */
export default function OtpScreen(): ReactElement {
  const params = useLocalSearchParams<{ mobile?: string; retryAfter?: string }>();
  const mobile = params.mobile ?? '';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>('OTP Sent Successfully');
  const [secondsLeft, setSecondsLeft] = useState(() => Number(params.retryAfter ?? 30));

  // Guards the auto-submit below. Without it, a failed verify that leaves six digits on screen
  // re-submits on the next render and burns the customer's five attempts in a loop.
  const submittedFor = useRef<string | null>(null);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const verify = useMutation({
    mutationFn: (otp: string) => verifyOtp({ mobile_number: mobile, otp }),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: async (result) => {
      await session.beginSession(result);
      // `replace`, so back from the signed-in app exits rather than returning to a code that has
      // already been consumed.
      router.replace(result.is_new_user === true ? '/profile-setup' : '/home');
    },
    onError: (cause) => {
      setCode('');
      submittedFor.current = null;
      setError(cause instanceof Error ? cause.message : 'That code did not work. Please try again.');
    },
  });

  const resend = useMutation({
    mutationFn: () => sendOtp({ mobile_number: mobile }),
    onMutate: () => {
      setError(null);
      setCode('');
      submittedFor.current = null;
    },
    onSuccess: (result) => {
      setSecondsLeft(result.retry_after_seconds);
      setNotice('OTP Sent Successfully');
    },
    onError: (cause) => {
      // A cooldown rejection still carries the server's own countdown; adopting it keeps the
      // timer honest instead of leaving the button enabled into a second rejection.
      if (cause instanceof ApiError) {
        const retryAfter = cause.retryAfterSeconds;
        if (retryAfter !== undefined) setSecondsLeft(retryAfter);
      }
      setError(cause instanceof Error ? cause.message : 'Could not resend the code.');
    },
  });

  const handleFilled = useCallback(
    (filled: string) => {
      if (submittedFor.current === filled) return;
      submittedFor.current = filled;
      verify.mutate(filled);
    },
    [verify],
  );

  const busy = verify.isPending;
  const canResend = secondsLeft <= 0 && !resend.isPending && !busy;

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
            <View style={styles.headerBar}>
              <Pressable
                onPress={() => router.back()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Go back"
                style={styles.backButton}
              >
                <Feather name="arrow-left" size={22} color={colors.fg} />
              </Pressable>
              <Text style={styles.headerTitle}>Verify OTP</Text>
              {/* Balances the back button so the title stays optically centred. */}
              <View style={styles.backButton} />
            </View>

            <View style={styles.headerLogo}>
              <Logo width={210} />
            </View>
          </View>

          <WaveHeaderEdge height={54} />

          {/* Pulled up over the wave so the circle straddles the yellow/white boundary. */}
          <View style={styles.badgeWrap}>
            <View style={styles.badge}>
              <Feather name="message-square" size={30} color={colors.fg} />
            </View>
          </View>

          <View style={styles.body}>
            <Text style={styles.title}>Enter the {OTP_LENGTH}-digit code</Text>
            <Text style={styles.sub}>We have sent an OTP to</Text>
            <Text style={styles.number}>{formatForDisplay(mobile)}</Text>

            {notice !== null ? (
              <View style={styles.noticeRow} accessibilityLiveRegion="polite">
                <Feather name="check" size={16} color={colors.success} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

            {error !== null ? (
              <Text style={styles.errorText} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}

            <View style={styles.otpBlock}>
              <OtpInput
                value={code}
                onChange={(next) => {
                  setCode(next);
                  if (error !== null) setError(null);
                }}
                onFilled={handleFilled}
                length={OTP_LENGTH}
                editable={!busy}
                invalid={error !== null}
              />
            </View>

            <View style={styles.statusRow}>
              {busy ? (
                <>
                  <ActivityIndicator size="small" color={colors.focus} />
                  <Text style={styles.statusText}>Verifying…</Text>
                </>
              ) : (
                <Text style={styles.statusHint}>
                  The code fills in automatically from your SMS
                </Text>
              )}
            </View>

            <View style={styles.resendRow}>
              {canResend ? (
                <Pressable onPress={() => resend.mutate()} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.resendAction}>Resend OTP</Text>
                </Pressable>
              ) : (
                <Text style={styles.resendWaiting}>
                  Resend OTP in{' '}
                  <Text style={styles.resendCountdown}>{formatCountdown(secondsLeft)}</Text>
                </Text>
              )}
            </View>

            <View style={styles.helpCard}>
              <View style={styles.helpIcon}>
                <Feather name="shield" size={18} color={colors.fg} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.helpTitle}>Didn&apos;t receive the code?</Text>
                <Text style={styles.helpBody}>
                  Make sure your number is correct and check your SMS inbox.
                </Text>
              </View>
            </View>

            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.orLine} />
            </View>

            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              style={({ pressed }) => [styles.changeButton, pressed && styles.changePressed]}
            >
              <Feather name="edit-2" size={17} color={colors.fg} />
              <Text style={styles.changeLabel}>Change Mobile Number</Text>
            </Pressable>
          </View>

          <View style={styles.assuranceBar}>
            <Feather name="lock" size={20} color={colors.fg} />
            <View style={styles.assuranceCopy}>
              <Text style={styles.assuranceTitle}>Your information is 100% secure</Text>
              <Text style={styles.assuranceBody}>We never share your data with anyone.</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** `88` → `01:28`. Always two-and-two, so the row does not reflow as digits drop. */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  // `flexGrow`, not `flex`: on a tall screen this pushes the assurance bar to the bottom, and on
  // a short one the content still scrolls instead of being squashed.
  scrollContent: { flexGrow: 1 },

  header: { backgroundColor: colors.brand, paddingHorizontal: space.lg },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg },
  headerLogo: { alignItems: 'center', marginTop: space.md, marginBottom: space.sm },

  badgeWrap: { alignItems: 'center', marginTop: -46 },
  badge: {
    width: 92,
    height: 92,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },

  // Grows to fill whatever the header and assurance bar leave, so the pale band sits at the
  // bottom of a tall screen rather than floating mid-page.
  body: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.md },
  title: { ...text.title, color: colors.fg, textAlign: 'center' },
  sub: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.sm },
  number: { ...text.body, fontWeight: '700', color: colors.fg, textAlign: 'center', marginTop: 2 },

  noticeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: space.sm },
  noticeText: { ...text.body, color: colors.success, marginLeft: 6 },
  errorText: { ...text.body, color: colors.danger, textAlign: 'center', marginTop: space.sm },

  otpBlock: { marginTop: space.lg },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
    minHeight: 22,
  },
  statusText: { ...text.body, color: colors.muted, marginLeft: space.sm },
  statusHint: { ...text.caption, color: colors.faint },

  resendRow: { alignItems: 'center', marginTop: space.md },
  resendWaiting: { ...text.body, color: colors.muted },
  resendCountdown: { color: colors.focus, fontWeight: '700' },
  resendAction: { ...text.body, fontWeight: '700', color: colors.link },

  helpCard: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.lg,
    ...shadow.soft,
  },
  helpIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  helpTitle: { ...text.label, fontSize: 15, color: colors.fg },
  helpBody: { ...text.body, color: colors.muted, marginTop: 2 },

  orRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.lg },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { ...text.caption, color: colors.muted, paddingHorizontal: space.md },

  changeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: space.md,
    marginBottom: space.xl,
  },
  changePressed: { backgroundColor: colors.bgSunken },
  changeLabel: { ...text.body, fontWeight: '600', color: colors.fg, marginLeft: space.sm },

  assuranceBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandSoft,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  assuranceCopy: { marginLeft: space.md },
  assuranceTitle: { ...text.label, fontSize: 14, color: colors.fg },
  assuranceBody: { ...text.caption, color: colors.muted, marginTop: 1 },
});
