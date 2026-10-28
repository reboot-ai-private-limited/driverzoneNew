import { Feather } from '@expo/vector-icons';
import type { BookingDto, DriverPaymentQrDto } from '@driverzone/contracts';
import * as Haptics from 'expo-haptics';
import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createPaymentQr, getPaymentQr } from '@/lib/api/endpoints/trip';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/** How often the screen asks the server whether the money has arrived. */
const POLL_MS = 2_000;

/** How long the green "received" screen stays before closing itself. */
const PAID_LINGER_MS = 1_600;

interface PaymentQrSheetProps {
  visible: boolean;
  bookingId: string;
  /** The trip as the server now holds it — handed back on every poll so the screen behind follows. */
  onBooking: (booking: BookingDto) => void;
  onClose: () => void;
  /** "They paid me cash instead" — closes this and opens the cash sheet. */
  onCash: () => void;
}

/**
 * THE DRIVER COLLECTS THE WHOLE TRIP BY QR.
 *
 * Shown full-screen on white — a QR needs the contrast and the room, and a customer has to be able
 * to scan it off a phone held across a car. The customer scans it with ANY UPI app (GPay, PhonePe,
 * Paytm, a bank's own); nothing on their side needs this app.
 *
 * **THE SERVER SAYS WHEN THE MONEY HAS ARRIVED, never the driver and never this screen.** It polls
 * `GET /payment-qr`, which asks the payment provider directly if the webhook has not landed, and
 * the green screen appears only when the server answers `PAID`. The end-trip slide behind this
 * unlocks from the same answer (the booking handed back becomes `payment_status: PAID`).
 *
 * The amount is whatever the server put on the QR — the fare, any extra day and waiting charge,
 * less wallet credit — read back from the QR itself, so the figure on screen is the figure the
 * customer's UPI app will show.
 */
export function PaymentQrSheet({
  visible,
  bookingId,
  onBooking,
  onClose,
  onCash,
}: PaymentQrSheetProps): ReactElement {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const qrSize = Math.min(width - space.lg * 2 - space.xl * 2, 300);

  const [qr, setQr] = useState<DriverPaymentQrDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Held in refs so the polling loop never reads a stale copy of a callback the parent re-created.
  const onBookingRef = useRef(onBooking);
  const onCloseRef = useRef(onClose);
  onBookingRef.current = onBooking;
  onCloseRef.current = onClose;

  /** Makes (or re-shows) the QR. Also what "Generate new QR" runs. */
  const start = useCallback(async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      const result = await createPaymentQr(bookingId);
      setQr(result.qr);
      onBookingRef.current(result.booking);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not make the QR code.');
    } finally {
      setStarting(false);
    }
  }, [bookingId]);

  // Opening the screen makes the QR; reopening starts clean rather than flashing the last one.
  useEffect(() => {
    if (!visible) return;
    setQr(null);
    void start();
  }, [visible, start]);

  // While a QR is waiting to be paid, ask the server. Stops the moment it is paid or expired.
  const state = qr?.state;
  useEffect(() => {
    if (!visible || state !== 'PENDING') return;

    let cancelled = false;
    const timer = setInterval(() => {
      void getPaymentQr(bookingId)
        .then((result) => {
          if (cancelled) return;
          setQr(result.qr);
          onBookingRef.current(result.booking);
        })
        // A dropped poll is not an error worth showing — the next one is two seconds away.
        .catch(() => undefined);
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, state, bookingId]);

  // The countdown, from the expiry the server set.
  const expiresAt = qr?.expires_at ?? null;
  useEffect(() => {
    if (expiresAt === null) {
      setSecondsLeft(null);
      return;
    }
    const tick = (): void =>
      setSecondsLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // Paid: a buzz, a moment on the green screen, then back to the trip with the slide unlocked.
  useEffect(() => {
    if (!visible || state !== 'PAID') return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const timer = setTimeout(() => onCloseRef.current(), PAID_LINGER_MS);
    return () => clearTimeout(timer);
  }, [visible, state]);

  // The countdown can reach zero a beat before the server's own expiry — treat it as expired here
  // too, so the driver is never shown a QR the countdown says is dead.
  const expired = state === 'EXPIRED' || (state === 'PENDING' && secondsLeft === 0);
  const paid = state === 'PAID';
  const amount = qr?.amount?.amount_display ?? null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <View style={styles.header}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.close}
          >
            <Feather name="x" size={22} color={colors.fg} />
          </Pressable>
          <Text style={styles.headerTitle}>Collect payment</Text>
          <View style={styles.close} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {paid ? (
            <View style={styles.centre}>
              <View style={styles.paidCircle}>
                <Feather name="check" size={48} color={colors.onFg} />
              </View>
              <Text style={styles.paidTitle}>{amount ?? 'Payment'} received</Text>
              <Text style={styles.paidBody}>You can end the trip now.</Text>
            </View>
          ) : error !== null && qr === null ? (
            <View style={styles.centre}>
              <Feather name="alert-circle" size={36} color={colors.danger} />
              <Text style={styles.errorTitle}>Could not make the QR code</Text>
              <Text style={styles.errorBody}>{error}</Text>
              <Pressable onPress={() => void start()} accessibilityRole="button" style={styles.primary}>
                <Text style={styles.primaryLabel}>Try again</Text>
              </Pressable>
            </View>
          ) : qr === null || starting ? (
            <View style={styles.centre}>
              <ActivityIndicator size="large" color={colors.fg} />
              <Text style={styles.muted}>Making the QR code…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.amountLabel}>Customer pays</Text>
              <Text style={styles.amount}>{amount}</Text>

              <View style={[styles.qrCard, expired && styles.qrCardDead]}>
                {qr.upi_uri !== null ? (
                  <QRCode value={qr.upi_uri} size={qrSize} backgroundColor="#FFFFFF" color="#000000" ecl="M" />
                ) : qr.image_url !== null ? (
                  <Image source={{ uri: qr.image_url }} style={{ width: qrSize, height: qrSize }} resizeMode="contain" />
                ) : (
                  <View style={{ width: qrSize, height: qrSize }} />
                )}

                {/* An expired QR is dimmed AND covered: a dead code must never look scannable. */}
                {expired ? (
                  <View style={styles.expiredCover}>
                    <Feather name="clock" size={30} color={colors.fg} />
                    <Text style={styles.expiredTitle}>QR expired</Text>
                  </View>
                ) : null}
              </View>

              {expired ? (
                <Pressable
                  onPress={() => void start()}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                >
                  <Feather name="refresh-cw" size={16} color={colors.brandOnFg} />
                  <Text style={styles.primaryLabel}>Generate new QR</Text>
                </Pressable>
              ) : (
                <View style={styles.statusRow}>
                  <ActivityIndicator size="small" color={colors.fg} />
                  <Text style={styles.statusText}>Waiting for payment…</Text>
                  {secondsLeft === null ? null : (
                    <Text style={styles.countdown}>
                      {String(Math.floor(secondsLeft / 60)).padStart(2, '0')}:
                      {String(secondsLeft % 60).padStart(2, '0')}
                    </Text>
                  )}
                </View>
              )}

              <Text style={styles.hint}>
                Ask the customer to scan with GPay, PhonePe, Paytm or any UPI app. The trip can be
                ended once the payment shows here.
              </Text>

              {qr.lines.length > 1 ? (
                <View style={styles.lines}>
                  {qr.lines.map((line) => (
                    <View key={line.label} style={styles.lineRow}>
                      <Text style={styles.lineLabel}>{line.label}</Text>
                      <Text style={styles.lineValue}>
                        {line.amount.amount_paise < 0 ? '−' : ''}
                        {line.amount.amount_display.replace('-', '')}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {paid ? null : (
          <Pressable
            onPress={onCash}
            accessibilityRole="button"
            style={({ pressed }) => [styles.cashLink, pressed && styles.pressed]}
          >
            <Text style={styles.cashLinkText}>Customer paid me cash instead</Text>
          </Pressable>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  close: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg, flex: 1, textAlign: 'center' },

  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: space.lg, paddingBottom: space.lg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xl },
  muted: { ...text.body, color: colors.muted },

  amountLabel: { ...text.caption, color: colors.muted, marginTop: space.sm },
  amount: { ...text.heading, color: colors.fg, fontSize: 40, lineHeight: 48, fontFamily: fontFamily.bold },

  // White and padded on every side — a QR needs its quiet zone, or phones fail to read it.
  qrCard: {
    marginTop: space.md,
    padding: space.xl,
    borderRadius: radius.lg,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
  },
  qrCardDead: { opacity: 0.35 },
  expiredCover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  expiredTitle: { ...text.heading, color: colors.fg },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  statusText: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  countdown: {
    ...text.label,
    color: colors.muted,
    backgroundColor: colors.bgSunken,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  hint: { ...text.caption, color: colors.muted, textAlign: 'center', marginTop: space.md },

  lines: {
    alignSelf: 'stretch',
    marginTop: space.lg,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    gap: space.xs,
  },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  lineLabel: { ...text.caption, color: colors.muted, flex: 1 },
  lineValue: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },

  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    alignSelf: 'stretch',
    marginTop: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.fg,
  },
  primaryLabel: { ...text.label, color: colors.brandOnFg, fontFamily: fontFamily.bold },
  pressed: { opacity: 0.6 },

  paidCircle: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.success,
  },
  paidTitle: { ...text.heading, color: colors.fg, fontSize: 28, lineHeight: 34, marginTop: space.md },
  paidBody: { ...text.body, color: colors.muted },

  errorTitle: { ...text.heading, color: colors.fg, marginTop: space.sm },
  errorBody: { ...text.body, color: colors.muted, textAlign: 'center' },

  cashLink: { alignItems: 'center', paddingVertical: space.md },
  cashLinkText: { ...text.caption, color: colors.fg, textDecorationLine: 'underline', fontFamily: fontFamily.semibold },
});
