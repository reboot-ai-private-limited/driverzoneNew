import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Logo } from '@/components/Logo';
import { OtpInput } from '@/components/OtpInput';
import { WaveHeaderEdge } from '@/components/Wave';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { ApiError } from '@/lib/api/ApiError';
import { sendOtp, verifyOtp } from '@/lib/api/endpoints/auth';
import { updateProfile } from '@/lib/api/endpoints/customer';
import * as session from '@/lib/auth/session';
import { colors, fontFamily, space, text } from '@/theme/theme';

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
  const params = useLocalSearchParams<{
    mobile?: string;
    retryAfter?: string;
    whatsappOffers?: string;
  }>();
  const mobile = params.mobile ?? '';

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Only a RESEND raises this. Announcing the first code on arrival tells the customer something
  // the navigation itself already did.
  const [notice, setNotice] = useState<string | null>(null);
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
      // The optional WhatsApp offers box on the sign-in screen. Only an explicit tick is sent —
      // an untouched box never overwrites a choice an existing customer made earlier. Best
      // effort: a failure here must not stand between the customer and the app, and the choice
      // can be made again under Profile → Notifications.
      if (params.whatsappOffers === '1') {
        await updateProfile({ whatsapp_marketing_opt_in: true }).catch(() => undefined);
      }
      // `replace`, so back from the signed-in app exits rather than returning to a code that has
      // already been consumed. A name is required, so an account without one finishes setup first.
      const needsName = result.is_new_user === true || (result.user.full_name ?? '').trim() === '';
      router.replace(needsName ? '/profile-setup' : '/home');
    },
    onError: (cause) => {
      setCode('');
      submittedFor.current = null;
      setError(
        cause instanceof Error ? cause.message : 'That code did not work. Please try again.',
      );
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

  /**
   * "It never came on WhatsApp" — the same code, sent by SMS instead.
   *
   * A SEPARATE MUTATION FROM `resend`, not a flag on it, because the two are different requests
   * with different costs and different rules. Resend is free and paced by the cooldown; this one
   * is a paid message the server deliberately exempts from that cooldown, since the wait it would
   * impose is the wait for a message that already failed to arrive.
   *
   * It is NOT gated on `canResend`. Gating it would reintroduce exactly the countdown the server
   * stopped enforcing, and leave the control dead at the only moment anyone reaches for it.
   */
  const smsResend = useMutation({
    mutationFn: () => sendOtp({ mobile_number: mobile, channel: 'SMS' }),
    onMutate: () => {
      setError(null);
      setCode('');
      submittedFor.current = null;
    },
    onSuccess: (result) => {
      // Still adopts the server's countdown: the WhatsApp resend is paced by it even though this
      // send was not, so the row above must not offer a button the server would refuse.
      setSecondsLeft(result.retry_after_seconds);
      setNotice('Code sent by SMS');
    },
    onError: (cause) => {
      if (cause instanceof ApiError) {
        const retryAfter = cause.retryAfterSeconds;
        if (retryAfter !== undefined) setSecondsLeft(retryAfter);
      }
      setError(cause instanceof Error ? cause.message : 'Could not send the code by SMS.');
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
      <KeyboardAwareScrollView
        style={styles.flex}
        bottomOffset={24}
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
            <Logo width={180} />
          </View>
        </View>

        <WaveHeaderEdge height={54} />

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
                Resend OTP in{' '}
                <Text style={styles.resendCountdown}>{formatCountdown(secondsLeft)}</Text>
              </Text>
            )}
          </View>

          {/*
            THE WAY OUT WHEN WHATSAPP DID NOT ARRIVE, and deliberately quiet: small, muted, and
            below the resend row, because it is the second thing to try rather than the offer.
            Most codes arrive on WhatsApp, and a prominent SMS button would push people onto a
            paid channel they did not need.

            Live even during the resend countdown — the server exempts an explicit SMS request
            from the cooldown precisely so this works at the moment it is wanted.
          */}
          <View style={styles.smsRow}>
            <Text style={styles.smsHint}>Didn&apos;t get it on WhatsApp? </Text>
            <Pressable
              onPress={() => smsResend.mutate()}
              disabled={smsResend.isPending || busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: smsResend.isPending || busy }}
              hitSlop={8}
            >
              <Text style={[styles.smsLink, (smsResend.isPending || busy) && styles.smsLinkOff]}>
                {smsResend.isPending ? 'Sending…' : 'Get code by SMS'}
              </Text>
            </Pressable>
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
      </KeyboardAwareScrollView>
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

  header: { backgroundColor: colors.brand, paddingHorizontal: space.lg },
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

  // One line, centred, and a size down from the resend row above it — the visual order matches
  // the order these should be tried in.
  smsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: space.sm,
  },
  smsHint: { ...text.caption, color: colors.faint },
  smsLink: { ...text.caption, color: colors.link, fontWeight: '700', fontFamily: fontFamily.bold },
  smsLinkOff: { color: colors.faint },
  resendCountdown: { color: colors.fg, fontWeight: '700', fontFamily: fontFamily.bold },

  link: { ...text.body, color: colors.link },
  linkStrong: { ...text.body, fontWeight: '700', fontFamily: fontFamily.bold, color: colors.link },

  spacer: { flex: 1, minHeight: space.xl },
  changeButton: { alignItems: 'center', paddingVertical: space.md, marginBottom: space.lg },
});
