import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { CreateBookingResponse } from '@driverzone/contracts';
import { BottomSheet } from '@/components/BottomSheet';
import { Checkbox } from '@/components/Checkbox';
import { FareOptionCard } from '@/components/FareOptionCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  needsDriverExpenseAgreement,
  tripFacts,
  unavailableTitle,
  useQuoteCountdown,
} from '@/features/booking/quote';
import type { TripPoint } from '@/features/booking/tripPoint';
import type { TripQuote } from '@/features/booking/useTripQuote';
import { ApiError } from '@/lib/api/ApiError';
import { createBooking } from '@/lib/api/endpoints/bookings';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface FareSheetProps {
  visible: boolean;
  onClose: () => void;
  trip: TripQuote;
  onRequote: () => void;
  /** Where the trip starts and ends, WITH the address strings `POST /bookings` sends verbatim. */
  pickup: TripPoint | null;
  drop: TripPoint | null;
}

/**
 * The fare card, as a sheet over the map rather than a screen of its own.
 *
 * **Why not a route.** Choosing a fare is not a departure from the booking screen, it is the last
 * question the booking screen asks — and every ride-hailing app the customer already uses answers
 * it in a sheet with the map still behind it. A pushed screen breaks that: the trip they just
 * assembled slides away, the map goes with it, and changing a pin means a back navigation and a
 * remount rather than a dismiss. Keeping it here also means the quote, the pins and the trip
 * options are all one component's state, so nothing has to be serialised through route params and
 * parsed back.
 *
 * **It renders the quote it is given, and never fetches.** Home already holds the answer — it
 * needs it to decide whether Continue can be pressed at all — so this receives the same
 * `TripQuote` rather than asking a second time.
 */
export function FareSheet({
  visible,
  onClose,
  trip,
  onRequote,
  pickup,
  drop,
}: FareSheetProps): ReactElement {
  const { card, unavailable, query, stale } = trip;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const countdown = useQuoteCountdown(card?.expires_at ?? null);

  const options = card?.options ?? [];
  /*
   * DERIVED, not stored. `selectedId` is a preference laid over whatever options are current; a
   * re-quote returns new ids, the stored one matches nothing, and this falls back to the first
   * option on its own. Resetting it in an effect instead would leave one render where the
   * selection points at a fare card that no longer exists.
   */
  const selected = options.find((option) => option.quote_id === selectedId) ?? options[0] ?? null;
  const many = options.length > 1;
  const facts = card === null ? null : tripFacts(card);

  /**
   * Whether THIS selected option carries the driver-expenses warning — every option except the
   * incity 3-hour package does, and switching options can flip it either way.
   */
  const needsAgreement = selected !== null && needsDriverExpenseAgreement(selected);
  const [agreed, setAgreed] = useState(false);

  /**
   * ONE KEY PER ATTEMPT, held in a ref so it survives re-renders but not a change of mind. It
   * covers every RETRY of confirming THIS option — a flaky connection resending the same tap must
   * charge or book once — which is exactly why it must NOT be regenerated on every render, only
   * when what is being confirmed actually changes.
   */
  const idempotencyKey = useRef(Crypto.randomUUID());

  /**
   * RE-CONSENT ON EVERY SELECTION CHANGE, not just when the warning appears or disappears. A tick
   * left over from the 6-hour option should not silently cover the outstation package the
   * customer switched to a moment later — a checked box is supposed to mean "I read this for the
   * trip I am about to pay for", not "I once ticked a box in this sheet". A re-quote lands here
   * too: it hands back new `quote_id`s, so this is also where a stale idempotency key from an
   * expired price gets replaced rather than reused for a different one.
   */
  useEffect(() => {
    setAgreed(false);
    idempotencyKey.current = Crypto.randomUUID();
  }, [selected?.quote_id]);

  /**
   * CASH ONLY, FOR NOW. `PaymentMode` also has `'UPI'`, which needs a real checkout SDK this app
   * does not carry yet — see the decision to keep this a demo without one. Cash is not a
   * placeholder standing in for that: it is a first-class path the API confirms synchronously,
   * with no gateway, no client token and no webhook to wait on, so this is the whole booking flow
   * working for real, just without a payment screen.
   */
  const confirmBooking = useMutation<CreateBookingResponse, Error, void>({
    mutationFn: () => {
      if (selected === null || pickup === null || drop === null) {
        return Promise.reject(new Error('This trip is missing a pickup or a destination.'));
      }
      return createBooking(
        {
          quoteId: selected.quote_id,
          pickupAddress: pickup.address,
          dropAddress: drop.address,
          paymentMode: 'CASH',
        },
        idempotencyKey.current,
      );
    },
    onSuccess: (result) => {
      onClose();
      // The SEARCHING screen, not the trip screen directly — dispatch has not run yet at this
      // instant (CASH confirms synchronously; the wave that finds a driver is a separate queued
      // job), so landing straight on the trip screen would show a customer a receipt with a
      // "Finding your driver" line buried in it instead of the full-screen moment that deserves.
      router.push(`/searching/${result.booking.id}`);
    },
  });

  /**
   * The one error worth its own words. Every other failure gets the server's own `message`
   * (`confirmBooking.error.message`); this one is a 409 with no fare left behind it, so pressing
   * Confirm again would just fail the same way — the only useful next step is a new price.
   */
  const quoteExpired =
    confirmBooking.error instanceof ApiError && confirmBooking.error.code === 'QUOTE_EXPIRED';

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.title}>
            {card === null ? 'Your fare' : many ? 'Choose how long you need' : 'Your fare'}
          </Text>
          {facts === null ? null : <Text style={styles.facts}>{facts}</Text>}
        </View>

        {/*
          The countdown is a CHIP beside the title, not a line under the button. It is context for
          the prices being read right now, and it belongs where the eye already is rather than
          next to the action, where it would read as a warning about pressing.
        */}
        {card === null ? null : (
          <View style={[styles.timer, countdown.expired && styles.timerExpired]}>
            <Feather
              name={countdown.expired ? 'refresh-cw' : 'clock'}
              size={12}
              color={countdown.expired ? colors.danger : colors.muted}
            />
            <Text style={[styles.timerText, countdown.expired && styles.timerTextExpired]}>
              {countdown.expired ? 'Expired' : countdown.display}
            </Text>
          </View>
        )}
      </View>

      {query.isPending ? (
        <View style={styles.centre}>
          <ActivityIndicator color={colors.fg} />
          <Text style={styles.centreText}>Getting you a price…</Text>
        </View>
      ) : query.isError ? (
        <View style={styles.notice}>
          <Feather name="wifi-off" size={15} color={colors.fg} style={styles.noticeIcon} />
          <View style={styles.flex}>
            <Text style={styles.noticeTitle}>We could not get a price</Text>
            <Text style={styles.noticeBody}>
              {query.error instanceof Error ? query.error.message : 'Something went wrong.'}
            </Text>
          </View>
        </View>
      ) : unavailable !== null ? (
        /*
          The `available: false` answer, small and red, exactly as it reads on the home sheet — one
          "we cannot" surface in the app rather than two that differ by a few points of saturation.
          No button: there is no fare to confirm, and the way out is dismissing the sheet.
        */
        <Animated.View entering={FadeIn.duration(180)} style={[styles.notice, styles.noticeBad]}>
          <Feather name="alert-circle" size={15} color={colors.danger} style={styles.noticeIcon} />
          <View style={styles.flex}>
            <Text style={styles.noticeTitleBad}>{unavailableTitle(unavailable.reason)}</Text>
            <Text style={styles.noticeBody}>{unavailable.message}</Text>
          </View>
        </Animated.View>
      ) : (
        <ScrollView
          // Capped rather than free-growing: an incity package with five durations must not push
          // the confirm button off the bottom of the screen.
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          // Dimmed AND inert while a re-quote is in flight — a stale price presented at full
          // strength is a price the customer may act on.
          pointerEvents={stale ? 'none' : 'auto'}
        >
          <View style={stale ? styles.stale : undefined}>
            {options.map((option, index) => (
              <Animated.View
                key={option.quote_id}
                entering={FadeInDown.delay(index * 40).duration(200)}
              >
                <FareOptionCard
                  option={option}
                  selected={option.quote_id === (selected?.quote_id ?? null)}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setSelectedId(option.quote_id);
                  }}
                  // The selected card's lines only, so two prices are never legible at once.
                  showBreakdown={option.quote_id === (selected?.quote_id ?? null)}
                />
              </Animated.View>
            ))}
          </View>
        </ScrollView>
      )}

      {/*
        THE ONE WARNING EVERY TRIP CARRIES EXCEPT THE INCITY 3-HOUR PACKAGE — this app's price
        never includes what the driver eats, or where they stay if the trip runs that long. Placed
        between the list and the button rather than folded into the breakdown: it is not a fare
        line, it is money that changes hands outside this app entirely, and burying it among rows
        that ARE in the total would read as if it were one of them.
      */}
      {needsAgreement && !stale ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.terms}>
          <View style={styles.termsHead}>
            <Feather name="info" size={14} color={colors.muted} style={styles.noticeIcon} />
            <Text style={styles.termsBody}>
              This trip does not cover the driver&apos;s food, or a place to stay if it runs that
              long. You will settle that directly with the driver, not through the app.
            </Text>
          </View>
          <Checkbox
            checked={agreed}
            onChange={setAgreed}
            accessibilityLabel="I agree to cover the driver's food and stay directly"
          >
            <Text style={styles.termsAgree}>
              I understand and will cover these costs directly with the driver.
            </Text>
          </Checkbox>
        </Animated.View>
      ) : null}

      {countdown.expired && card !== null ? (
        <PrimaryButton
          label="Get a new price"
          onPress={onRequote}
          loading={query.isFetching}
          showArrow={false}
        />
      ) : query.isError ? (
        /*
          A FAILED REQUEST GETS A RETRY, an unavailable answer does not. The distinction is the one
          `isUnavailable` exists for: "we could not ask" is worth asking again, "there is nothing to
          sell you for this trip" is final and asking twice only wastes a quote.
        */
        <PrimaryButton
          label="Try again"
          onPress={onRequote}
          loading={query.isFetching}
          showArrow={false}
        />
      ) : unavailable !== null ? (
        <PrimaryButton label="Change the trip" onPress={onClose} showArrow={false} />
      ) : (
        <>
          <PrimaryButton
            label={
              quoteExpired
                ? 'Get a new price'
                : selected === null
                  ? 'Confirm booking'
                  : `Confirm booking · ${selected.fare.total.amount_display}`
            }
            onPress={() => {
              if (quoteExpired) {
                // A DIFFERENT ACTION WEARING THE SAME BUTTON, so the mutation's own failed state
                // must not follow it — otherwise the fresh price would render behind an error
                // banner for a booking attempt that has already been abandoned.
                confirmBooking.reset();
                onRequote();
                return;
              }
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              confirmBooking.mutate();
            }}
            loading={quoteExpired ? query.isFetching : confirmBooking.isPending}
            // The agreement gate does not apply to "get a new price" — that tap is not the one
            // the checkbox is about, and blocking it would trap a customer who has not yet
            // agreed behind a stale price they cannot even refresh.
            disabled={quoteExpired ? false : needsAgreement && !agreed}
            showArrow={false}
          />
          <Text
            style={[styles.pending, (quoteExpired || confirmBooking.isError) && styles.pendingBad]}
            numberOfLines={2}
          >
            {quoteExpired
              ? 'That price just expired — this gets you a current one.'
              : confirmBooking.isError
                ? confirmBooking.error instanceof Error
                  ? confirmBooking.error.message
                  : 'Could not confirm your booking.'
                : needsAgreement && !agreed
                  ? 'Agree to the note above to confirm.'
                  : 'Pay the driver in cash at the end of your trip.'}
          </Text>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },

  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md },
  headText: { flex: 1, paddingRight: space.sm },
  title: { ...text.heading, color: colors.fg },
  facts: { ...text.caption, color: colors.muted, marginTop: 2 },

  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
  },
  timerExpired: { backgroundColor: '#FDECEC' },
  timerText: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },
  timerTextExpired: { color: colors.danger },

  centre: { paddingVertical: space.xl, alignItems: 'center' },
  centreText: { ...text.body, color: colors.muted, marginTop: space.sm },

  list: { maxHeight: 340, marginBottom: space.sm },
  listContent: { paddingBottom: 2 },
  stale: { opacity: 0.45 },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
    padding: space.sm,
    marginBottom: space.md,
  },
  noticeBad: { backgroundColor: '#FDECEC', borderColor: '#F5C2C2' },
  noticeIcon: { marginRight: space.sm, marginTop: 1 },
  noticeTitle: { ...text.label, color: colors.fg },
  noticeTitleBad: { ...text.label, color: colors.danger },
  noticeBody: { ...text.caption, color: colors.fg, marginTop: 2 },

  pending: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.sm },
  pendingBad: { color: colors.danger },

  terms: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
    padding: space.sm,
    marginBottom: space.md,
  },
  termsHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.sm },
  termsBody: { ...text.caption, color: colors.muted, flex: 1 },
  termsAgree: { ...text.caption, color: colors.fg },
});
