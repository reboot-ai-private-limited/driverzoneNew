import { Feather } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { OtpInput } from '@/components/OtpInput';
import { Logo } from '@/components/Logo';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { ApiError } from '@/lib/api/ApiError';
import { sendOtp, verifyOtp } from '@/lib/api/endpoints/auth';
import * as session from '@/lib/auth/session';
import { colors, fontFamily, space, text } from '@/theme/theme';

const OTP_LENGTH = 6;

/**
 * Step two of two. Verifies the code and starts the session.
 *
 * The resend countdown is driven ENTIRELY by the server's `retry_after_seconds` — carried in
 * from the previous screen, then refreshed by each resend. The per-phone cooldown lives in
 * `SendOtpUseCase`, so a client-side timer of its own invention would either let the driver tap
 * into a guaranteed rejection or hold them back longer than the server actually requires.
 */
export default function OtpScreen(): ReactElement {
  const params = useLocalSearchParams<{ mobile?: string; retryAfter?: string }>();
  const mobile = params.mobile ?? '';
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Only a RESEND raises this. Announcing the first code on arrival tells the driver something
  // the navigation itself already did.
  const [notice, setNotice] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(() => Number(params.retryAfter ?? 30));

  // Guards the auto-submit below. Without it, a failed verify that leaves six digits on screen
  // re-submits on the next render and burns the driver's five attempts in a loop.
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

      // A stale profile from a PREVIOUS driver on this device would otherwise decide the gate's
      // routing. Clearing is cheap and the alternative is a driver briefly seeing someone else's
      // onboarding state — a shared phone is normal in this market.
      queryClient.clear();

      /**
       * Everyone goes to `/gate`, including a brand-new account.
       *
       * The tempting shortcut is `is_new_user ? '/onboarding-profile' : '/gate'`, and it is
       * wrong: `is_new_user` says the ACCOUNT was just created, not that onboarding is
       * incomplete. A driver who signed up on another phone, or who was approved and then
       * reinstalled, is not new but may be at any status. `/gate` reads the profile and is the
       * one place that decides — so there is exactly one answer to "where does this driver go".
       */
      router.replace('/gate');
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
      setNotice('New code sent');
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
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
              <Logo width={150} />
            </View>
          </View>

          <View style={styles.body}>
            <Text style={styles.title}>Enter the {OTP_LENGTH}-digit code</Text>
            <Text style={styles.sub}>
              Sent to <Text style={styles.number}>{formatForDisplay(mobile)}</Text>
            </Text>

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

            {/* ONE reserved line for every transient message — verifying, resent, rejected — so
                none of them shifts the layout as it appears and clears. */}
            <View style={styles.statusRow} accessibilityLiveRegion="polite">
              {busy ? (
                <>
                  <ActivityIndicator size="small" color={colors.focus} />
                  <Text style={styles.statusText}>Verifying…</Text>
                </>
              ) : error !== null ? (
                <Text style={styles.errorText}>{error}</Text>
              ) : notice !== null ? (
                <Text style={styles.noticeText}>{notice}</Text>
              ) : null}
            </View>

            <View style={styles.resendRow}>
              {canResend ? (
                <Pressable onPress={() => resend.mutate()} accessibilityRole="button" hitSlop={8}>
                  <Text style={styles.linkStrong}>Resend OTP</Text>
                </Pressable>
              ) : (
                <Text style={styles.resendWaiting}>
                  Resend OTP in <Text style={styles.resendCountdown}>{formatCountdown(secondsLeft)}</Text>
                </Text>
              )}
            </View>

            {/* Holds the change-number link at the foot of a tall screen; collapses on a short one. */}
            <View style={styles.spacer} />

            <Pressable
              onPress={() => router.back()}
              accessibilityRole="button"
              hitSlop={8}
              style={styles.changeButton}
            >
              <Text style={styles.link}>Change mobile number</Text>
            </Pressable>
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
  // `flexGrow`, not `flex`: on a tall screen the body stretches to fill, and on a short one the
  // content still scrolls instead of being squashed.
  scrollContent: { flexGrow: 1 },

  header: { backgroundColor: colors.brand, paddingHorizontal: space.lg, paddingBottom: space.md },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg },
  headerLogo: { alignItems: 'center', marginTop: space.md, marginBottom: space.sm },

  body: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.lg },
  title: { ...text.title, color: colors.fg, textAlign: 'center' },
  sub: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.sm },
  number: { fontWeight: '700', fontFamily: fontFamily.bold, color: colors.fg },

  otpBlock: { marginTop: space.xl },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.md,
    minHeight: 22,
  },
  statusText: { ...text.body, color: colors.muted, marginLeft: space.sm },
  noticeText: { ...text.body, color: colors.success },
  errorText: { ...text.body, color: colors.danger, textAlign: 'center' },

  resendRow: { alignItems: 'center', marginTop: space.md },
  resendWaiting: { ...text.body, color: colors.muted },
  resendCountdown: { color: colors.fg, fontWeight: '700', fontFamily: fontFamily.bold },

  link: { ...text.body, color: colors.link },
  linkStrong: { ...text.body, fontWeight: '700', fontFamily: fontFamily.bold, color: colors.link },

  spacer: { flex: 1, minHeight: space.xl },
  changeButton: { alignItems: 'center', paddingVertical: space.md, marginBottom: space.lg },
});
