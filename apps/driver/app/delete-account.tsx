import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import type { AccountDeletionBlocker } from '@driverzone/contracts';
import { OtpInput } from '@/components/OtpInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { ApiError } from '@/lib/api/ApiError';
import {
  deleteAccount,
  getDeletionPreview,
  sendDeletionCode,
} from '@/lib/api/endpoints/accountDeletion';
import { getProfile } from '@/lib/api/endpoints/driver';
import * as session from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';
import { stopPushRegistration } from '@/notifications/registerDevice';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

const OTP_LENGTH = 6;

/** What is erased — the same list as the public `/delete-account` page, so the two never disagree. */
const ERASED = [
  'Your name, phone number, profile photo and details',
  'Your driving licence and every uploaded document',
  'This phone’s notification registration',
];

const KEPT = 'Records of completed trips and payments are kept, as the law requires, with your name removed.';

function formatRupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

/** The server's reasons, when a refusal carries them. */
function blockersOf(cause: unknown): AccountDeletionBlocker[] | null {
  if (!(cause instanceof ApiError) || cause.code !== 'ACCOUNT_DELETION_BLOCKED') return null;
  const reasons = (cause.data as { reasons?: unknown } | null)?.reasons;
  return Array.isArray(reasons) ? (reasons as AccountDeletionBlocker[]) : null;
}

/**
 * Delete account — two steps, and the second is a code sent to the account's own number.
 *
 * 1. REVIEW: what is erased, what is kept, what is given up (wallet credit), and — if anything
 *    stops it — every reason at once, with nothing sent. The server re-checks at each step.
 * 2. CODE: the same six-digit entry as sign-in. A correct code deletes immediately.
 *
 * The code is a DELETION code: a login code cannot be used here, nor this one to sign in.
 *
 * Once deleted, the server has already revoked every session; this device is signed out straight
 * away and sent to the start, where the same number can sign up again as a new, empty account.
 */
export default function DeleteAccountScreen(): ReactElement {
  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });
  const preview = useQuery({ queryKey: ['account-deletion', 'preview'], queryFn: getDeletionPreview });

  const [step, setStep] = useState<'review' | 'code'>('review');
  const [blockers, setBlockers] = useState<AccountDeletionBlocker[] | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const submittedFor = useRef<string | null>(null);

  const mobile = profile.data?.mobile_number ?? null;
  const shownBlockers = blockers ?? preview.data?.blockers ?? [];
  const forfeited = preview.data?.forfeited_wallet_credit_paise ?? 0;

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const send = useMutation({
    mutationFn: (channel?: 'SMS') => sendDeletionCode(channel),
    onMutate: () => {
      setError(null);
      setCode('');
      submittedFor.current = null;
    },
    onSuccess: (result, channel) => {
      setSecondsLeft(result.retry_after_seconds);
      if (step === 'code') setNotice(channel === 'SMS' ? 'Code sent by SMS' : 'New code sent');
      setStep('code');
    },
    onError: (cause) => {
      const reasons = blockersOf(cause);
      if (reasons !== null) {
        // Something changed since the preview — a trip was booked. Back to the review, with why.
        setBlockers(reasons);
        setStep('review');
        return;
      }
      if (cause instanceof ApiError && cause.retryAfterSeconds !== undefined) {
        setSecondsLeft(cause.retryAfterSeconds);
      }
      setError(cause instanceof Error ? cause.message : 'Could not send the code.');
    },
  });

  const confirm = useMutation({
    mutationFn: (otp: string) => deleteAccount(otp),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: async () => {
      // The server has erased the account and revoked every session. Clear this device too.
      stopPushRegistration();
      await session.signOut();
      router.replace('/phone');
    },
    onError: (cause) => {
      setCode('');
      submittedFor.current = null;
      const reasons = blockersOf(cause);
      if (reasons !== null) {
        setBlockers(reasons);
        setStep('review');
        return;
      }
      setError(cause instanceof Error ? cause.message : 'That code did not work. Please try again.');
    },
  });

  const handleFilled = useCallback(
    (filled: string) => {
      if (submittedFor.current === filled) return;
      submittedFor.current = filled;
      confirm.mutate(filled);
    },
    [confirm],
  );

  const busy = confirm.isPending;
  const canDelete = shownBlockers.length === 0 && preview.isSuccess;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (step === 'code' && !busy ? setStep('review') : router.back())}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.backButton}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Delete account</Text>
        <View style={styles.backButton} />
      </View>

      <KeyboardAwareScrollView
        style={styles.flex}
        bottomOffset={24}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {step === 'review' ? (
          <>
            <View style={styles.warningIcon}>
              <Feather name="alert-triangle" size={26} color={colors.danger} />
            </View>
            <Text style={styles.title}>This cannot be undone</Text>

            <Text style={styles.sectionLabel}>What is deleted</Text>
            {ERASED.map((line) => (
              <View key={line} style={styles.bulletRow}>
                <Feather name="x" size={15} color={colors.danger} style={styles.bulletIcon} />
                <Text style={styles.bulletText}>{line}</Text>
              </View>
            ))}

            <Text style={styles.sectionLabel}>What is kept</Text>
            <Text style={styles.bodyText}>{KEPT}</Text>

            {forfeited > 0 && (
              <View style={styles.forfeitCard}>
                <Feather name="gift" size={16} color={colors.fg} />
                <Text style={styles.forfeitText}>
                  Your wallet credit of <Text style={styles.strong}>{formatRupees(forfeited)}</Text> will be
                  lost.
                </Text>
              </View>
            )}

            {preview.isPending ? (
              <ActivityIndicator style={styles.spinner} color={colors.muted} />
            ) : preview.isError ? (
              <Text style={styles.errorText}>
                {preview.error instanceof Error ? preview.error.message : 'Could not check your account.'}
              </Text>
            ) : shownBlockers.length > 0 ? (
              <View style={styles.blockersCard}>
                <Text style={styles.blockersTitle}>You can’t delete your account yet</Text>
                {shownBlockers.map((blocker) => (
                  <View key={blocker.code} style={styles.bulletRow}>
                    <Feather name="info" size={15} color={colors.danger} style={styles.bulletIcon} />
                    <Text style={styles.bulletText}>{blocker.message}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {error !== null && <Text style={styles.errorText}>{error}</Text>}

            <View style={styles.actions}>
              <PrimaryButton
                label={mobile === null ? 'Send code' : `Send code to ${formatForDisplay(mobile)}`}
                onPress={() => send.mutate(undefined)}
                loading={send.isPending}
                disabled={!canDelete}
                showArrow={false}
              />
              <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.cancel}>
                <Text style={styles.cancelText}>Keep my account</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.title}>Enter the {OTP_LENGTH}-digit code</Text>
            <Text style={styles.bodyText}>
              Sent to <Text style={styles.strong}>{mobile === null ? 'your number' : formatForDisplay(mobile)}</Text>
              . Entering it deletes your account straight away.
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

            <View style={styles.statusRow} accessibilityLiveRegion="polite">
              {busy ? (
                <>
                  <ActivityIndicator size="small" color={colors.danger} />
                  <Text style={styles.statusText}>Deleting your account…</Text>
                </>
              ) : error !== null ? (
                <Text style={styles.errorText}>{error}</Text>
              ) : notice !== null ? (
                <Text style={styles.noticeText}>{notice}</Text>
              ) : null}
            </View>

            <View style={styles.resendRow}>
              {secondsLeft <= 0 ? (
                <Pressable
                  onPress={() => send.mutate(undefined)}
                  disabled={send.isPending || busy}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <Text style={styles.link}>Resend code</Text>
                </Pressable>
              ) : (
                <Text style={styles.muted}>Resend code in {secondsLeft}s</Text>
              )}
              <Pressable
                onPress={() => send.mutate('SMS')}
                disabled={send.isPending || busy}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={styles.link}>Get code by SMS</Text>
              </Pressable>
            </View>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg },

  content: { padding: space.lg, paddingBottom: space.xl },

  warningIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.md,
  },
  title: { ...text.title, color: colors.fg, marginBottom: space.sm },
  sectionLabel: {
    ...text.caption,
    color: colors.muted,
    fontFamily: fontFamily.semibold,
    textTransform: 'uppercase',
    marginTop: space.lg,
    marginBottom: space.xs,
  },
  bodyText: { ...text.body, color: colors.muted },
  strong: { color: colors.fg, fontFamily: fontFamily.semibold },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.xs },
  bulletIcon: { marginTop: 3, marginRight: space.sm },
  bulletText: { ...text.body, color: colors.fg, flex: 1 },

  forfeitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  forfeitText: { ...text.body, color: colors.fg, flex: 1 },

  blockersCard: {
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: '#FDECEC',
  },
  blockersTitle: { ...text.body, color: colors.danger, fontFamily: fontFamily.bold },

  spinner: { marginTop: space.lg },
  actions: { marginTop: space.xl, gap: space.sm },
  cancel: { alignItems: 'center', paddingVertical: space.md },
  cancelText: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },

  otpBlock: { marginTop: space.lg },
  statusRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  statusText: { ...text.body, color: colors.muted },
  errorText: { ...text.body, color: colors.danger, marginTop: space.md, textAlign: 'center' },
  noticeText: { ...text.body, color: colors.success },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: space.md,
  },
  link: { ...text.body, color: colors.focus, fontFamily: fontFamily.semibold },
  muted: { ...text.body, color: colors.muted },
});
