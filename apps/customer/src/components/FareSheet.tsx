import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type {
  CarCategory,
  CreateBookingResponse,
  VehicleTypePreference,
} from '@driverzone/contracts';
import { BottomSheet } from '@/components/BottomSheet';
import { CarChoice } from '@/components/CarChoice';
import { Checkbox } from '@/components/Checkbox';
import { FareOptionCard } from '@/components/FareOptionCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ToggleSwitch } from '@/components/ToggleSwitch';
import {
  needsDriverExpenseAgreement,
  tripFacts,
  unavailableTitle,
  useQuoteCountdown,
} from '@/features/booking/quote';
import { useFavouriteDrivers } from '@/features/favourites/useFavouriteDrivers';
import type { TripPoint } from '@/features/booking/tripPoint';
import type { TripQuote } from '@/features/booking/useTripQuote';
import { ApiError } from '@/lib/api/ApiError';
import { createBooking } from '@/lib/api/endpoints/bookings';
import { getWallet } from '@/lib/api/endpoints/wallet';
import { formatPaise } from '@/lib/money';
import { keys } from '@/lib/query/keys';
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
 * The two questions this sheet asks, in the order it asks them.
 *
 * `fare` — WHICH PRODUCT, when there is more than one. `details` — everything that is true
 * whichever one they picked: the car in the driveway, who to ring first, what the price does not
 * cover.
 */
type Stage = 'fare' | 'details';

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
 *
 * **TWO STAGES, because everything used to be on one.** The fare list, the wallet strip, two rows
 * of car chips, the favourites switch, the driver-expenses notice with its checkbox and its FAQ
 * link, and the confirm button all shared one sheet. The sheet is capped at the screen, so the
 * fares were squeezed into a 240pt scroll region with its indicator hidden — a list of prices the
 * customer could not see the bottom of, sitting above a form. Splitting it gives the prices the
 * whole sheet while they are being compared, and the rest of the questions the whole sheet once
 * that is decided.
 *
 * **The split only appears when there is something to split.** An outstation trip with one fare
 * has no choice to make, so it opens straight on `details` and the Back control never shows —
 * a first step containing a single non-choice is a tap charged for nothing.
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
   * Which stage the sheet is on — and it is REQUESTED, not absolute: with a single option there
   * is no fare stage to be on, so `stage` below resolves it against what is actually on offer.
   * Deriving it that way rather than forcing the state means a re-quote that collapses three
   * options into one cannot strand the customer on a picker with one row in it.
   */
  const [requestedStage, setRequestedStage] = useState<Stage>('fare');
  const stage: Stage = many ? requestedStage : 'details';

  /** The chosen fare's own breakdown, on the second stage. Closed by default: it is a reference. */
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  /*
   * A FRESH SHEET EVERY TIME IT OPENS. Without this, dismissing from the second stage and
   * reopening — a customer who changed a pin and came back — lands them on the car questions for
   * a trip whose prices they have not seen.
   */
  useEffect(() => {
    if (!visible) return;
    setRequestedStage('fare');
    setBreakdownOpen(false);
  }, [visible]);

  /**
   * Whether THIS selected option carries the driver-expenses warning — every option except the
   * incity 3-hour package does, and switching options can flip it either way.
   */
  const needsAgreement = selected !== null && needsDriverExpenseAgreement(selected);
  const [agreed, setAgreed] = useState(false);

  /**
   * WHICH CAR THE DRIVER IS BEING BOOKED FOR, and the only two answers on this sheet that are not
   * about money. Unlike `agreed`, they deliberately SURVIVE a change of fare option and a
   * re-quote: the car in the customer's driveway does not change because they switched from the
   * 3-hour package to the 6-hour one, and clearing it would make them answer twice for one trip.
   */
  const [carCategory, setCarCategory] = useState<CarCategory | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleTypePreference | null>(null);
  /**
   * Ring this customer's own drivers before anyone else.
   *
   * OFF BY DEFAULT AND NOT REMEMBERED between bookings. A favourite is worth a slightly longer
   * wait for the trip a customer chose it for; defaulting it on would quietly make every booking
   * slower for a preference they set once, months ago, about one driver.
   *
   * NOTHING HERE RE-QUOTES. Unlike every control in `TripOptions`, this does not touch the price —
   * which is exactly why it lives beside the car choice rather than up there with the ones that do.
   */
  const [preferFavouriteDrivers, setPreferFavouriteDrivers] = useState(false);
  const favourites = useFavouriteDrivers();
  const carChosen = carCategory !== null && vehicleType !== null;

  /**
   * The wallet, read only to SHOW what it will do — the server applies it, this never sends it.
   *
   * That split matters: a client that computed its own discount would be a client that could
   * disagree with the charge. What is rendered here is a preview of arithmetic that happens again,
   * authoritatively, in `createBooking`.
   */
  const wallet = useQuery({ queryKey: keys.wallet.me(), queryFn: getWallet });

  const creditPaise = wallet.data?.spendable_credit.amount_paise ?? 0;
  const owedPaise = wallet.data?.amount_owed.amount_paise ?? 0;
  const farePaise = selected?.fare.total.amount_paise ?? 0;
  // Capped at the fare, exactly as `applyWalletToFare` does on the server.
  const creditAppliedPaise = Math.min(creditPaise, farePaise);
  const payablePaise = farePaise - creditAppliedPaise + owedPaise;

  /**
   * ONE KEY PER ATTEMPT, held in a ref so it survives re-renders but not a change of mind. It
   * covers every RETRY of confirming THIS option — a flaky connection resending the same tap must
   * charge or book once — which is exactly why it must NOT be regenerated on every render, only
   * when what is being confirmed actually changes.
   */
  const idempotencyKey = useRef(Crypto.randomUUID());
  const queryClient = useQueryClient();

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
    // The open breakdown belonged to the previous fare. Left open it would animate its rows into
    // a different set of numbers under a heading the customer did not ask to change.
    setBreakdownOpen(false);
    idempotencyKey.current = Crypto.randomUUID();
  }, [selected?.quote_id]);

  /**
   * A RE-QUOTE THAT REPLACED THE OPTION THE CUSTOMER HAD CHOSEN sends them back to the prices.
   *
   * `selected` falls back to the first option whenever the stored id matches nothing — which is
   * right, and was invisible while everything lived on one sheet. On a second stage it is not: the
   * customer picked the 6-hour package, a re-quote landed, and they would be looking at car chips
   * above a button carrying the 3-hour price with nothing on screen saying so. Detected by the
   * fallback having fired, which is exactly the condition, rather than by watching the fare change
   * — a tap changes that too.
   */
  const selectionLost =
    selectedId !== null && !options.some((option) => option.quote_id === selectedId);

  useEffect(() => {
    if (selectionLost && many) setRequestedStage('fare');
  }, [selectionLost, many]);

  /**
   * The booking confirms and dispatches immediately without upfront payment.
   * The payment method (Cash or Online) is selected once the ride has STARTED.
   */
  const confirmBooking = useMutation<CreateBookingResponse, Error, void>({
    mutationFn: () => {
      if (selected === null || pickup === null || drop === null) {
        return Promise.reject(new Error('This trip is missing a pickup or a destination.'));
      }
      if (carCategory === null || vehicleType === null) {
        // Unreachable through the button, which is disabled until both are chosen. Here because
        // the request type demands them and a narrowed `null` is not a value to send.
        return Promise.reject(new Error('Choose your car type before confirming.'));
      }
      return createBooking(
        {
          quoteId: selected.quote_id,
          pickupAddress: pickup.address,
          dropAddress: drop.address,
          carCategory,
          vehicleType,
          preferFavouriteDrivers,
        },
        idempotencyKey.current,
      );
    },
    onSuccess: (result) => {
      // The booking just spent credit (or collected a debt), so the cached balance is now a lie —
      // and the wallet screen is two taps away.
      void queryClient.invalidateQueries({ queryKey: keys.wallet.me() });
      onClose();
      /*
       * The SEARCHING screen, not the trip screen directly — dispatch has not run yet at this
       * instant (CASH confirms synchronously; the wave that finds a driver is a separate queued
       * job), so landing straight on the trip screen would show a customer a receipt with a
       * "Finding your driver" line buried in it instead of the full-screen moment that deserves.
       *
       * EXCEPT WHEN THE TRIP IS FOR LATER, where that screen is a lie told for days. A scheduled
       * booking is not dispatched until 90 minutes before its pickup, so the radar would spin and
       * the "Searching for 41:12" chip would count up on a search that has not started and will
       * not for three days. The trip screen already says "Booking confirmed" for this exact state,
       * and it already carries the cancel bar.
       */
      router.push(
        result.booking.is_scheduled
          ? `/trip/${result.booking.id}`
          : `/searching/${result.booking.id}`,
      );
    },
  });

  /**
   * The one error worth its own words. Every other failure gets the server's own `message`
   * (`confirmBooking.error.message`); this one is a 409 with no fare left behind it, so pressing
   * Confirm again would just fail the same way — the only useful next step is a new price.
   */
  const quoteExpired =
    confirmBooking.error instanceof ApiError && confirmBooking.error.code === 'QUOTE_EXPIRED';

  /** A new price is a new decision — it comes back with the prices, not on the car questions. */
  function requote(): void {
    setRequestedStage('fare');
    onRequote();
  }

  /**
   * How tall the fare list may grow before it scrolls.
   *
   * Measured against the window rather than fixed at 240 as it was: that number was chosen when
   * the car chips and the terms block shared this sheet, and with them moved to the second stage
   * the prices can have the room. Still capped, because `BottomSheet` caps the sheet at the screen
   * and an uncapped list would push the Continue button off the bottom of it.
   */
  const { height: windowHeight } = useWindowDimensions();
  const listMaxHeight = Math.max(240, Math.min(440, windowHeight * 0.46));
  const detailMaxHeight = Math.max(260, Math.min(520, windowHeight * 0.54));

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.head}>
        {/*
          THE WAY BACK TO THE PRICES, and only when there were several to choose from. On a
          one-fare trip there is nothing behind this stage, and a Back control that dismisses the
          sheet instead of stepping back is the kind of small lie that costs a booking.
        */}
        {stage === 'details' && many ? (
          <Pressable
            onPress={() => setRequestedStage('fare')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Back to the fares"
            style={({ pressed }) => [styles.back, pressed && styles.backPressed]}
          >
            <Feather name="chevron-left" size={20} color={colors.fg} />
          </Pressable>
        ) : null}

        <View style={styles.headText}>
          <Text style={styles.title}>
            {card === null
              ? 'Your fare'
              : stage === 'details'
                ? 'Confirm your ride'
                : many
                  ? 'Choose how long you need'
                  : 'Your fare'}
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
      ) : stage === 'fare' ? (
        <ScrollView
          style={[styles.list, { maxHeight: listMaxHeight }]}
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
      ) : (
        /*
          STAGE TWO — everything that is true whichever fare they picked.
          In the order the customer meets it: what they are paying, what the wallet does to it,
          what the driver will be driving, who to ring first, and what the price does not cover.

          SCROLLED, because on a small phone two rows of chips, a switch and a consent block do not
          fit under a fare box — and the one control that must never be scrolled away, the button,
          is outside this view.
        */
        <ScrollView
          style={[styles.detail, { maxHeight: detailMaxHeight }]}
          contentContainerStyle={styles.detailContent}
          showsVerticalScrollIndicator={false}
          pointerEvents={stale ? 'none' : 'auto'}
        >
          <View style={stale ? styles.stale : undefined}>
            {selected === null ? null : (
              <>
                <FareOptionCard
                  option={selected}
                  selected
                  summary
                  onPress={() => setBreakdownOpen((open) => !open)}
                  showBreakdown={breakdownOpen}
                />
                {many ? (
                  <Pressable
                    onPress={() => setRequestedStage('fare')}
                    hitSlop={8}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.changeLink, pressed && styles.pressedDim]}
                  >
                    <Feather name="repeat" size={13} color={colors.fg} />
                    <Text style={styles.changeLinkText}>Choose a different fare</Text>
                  </Pressable>
                ) : null}
              </>
            )}

            {/*
              WHAT THE WALLET DOES TO THIS TRIP, shown before the button rather than discovered on
              the receipt. A customer with credit should see the number that made the total
              smaller, and one carrying a fee should learn about it here rather than by having
              Confirm refuse them.
            */}
            {creditAppliedPaise > 0 || owedPaise > 0 ? (
              <Animated.View entering={FadeIn.duration(180)} style={styles.wallet}>
                {creditAppliedPaise > 0 ? (
                  <View style={styles.walletRow}>
                    <Feather name="gift" size={14} color={colors.success} />
                    {/*
                      THE APPLIED FIGURE, not the balance. Credit is capped at the fare, so a
                      customer holding ₹500 against a ₹300 trip spends ₹300 — showing "−₹500"
                      beside a button reading ₹0 would be two numbers that do not add up.
                    */}
                    <Text style={styles.walletLabel}>
                      {creditPaise > farePaise
                        ? `Wallet credit (${formatPaise(creditPaise - creditAppliedPaise)} left over)`
                        : 'Wallet credit'}
                    </Text>
                    <Text style={styles.walletGood}>−{formatPaise(creditAppliedPaise)}</Text>
                  </View>
                ) : null}
                {owedPaise > 0 ? (
                  <View style={styles.walletRow}>
                    <Feather name="alert-circle" size={14} color={colors.danger} />
                    <Text style={styles.walletLabel}>Unpaid cancellation fee</Text>
                    <Text style={styles.walletBad}>
                      +{wallet.data?.amount_owed.amount_display ?? ''}
                    </Text>
                  </View>
                ) : null}
              </Animated.View>
            ) : null}

            <CarChoice
              category={carCategory}
              vehicleType={vehicleType}
              onCategory={setCarCategory}
              onVehicleType={setVehicleType}
            />

            {/*
              OFFERED ONLY TO A CUSTOMER WHO HAS FAVOURITES. A switch that can do nothing is worse
              than no switch: it promises a feature and then behaves identically either way.
              Someone who has never added one finds this row after their first trip, next to the
              driver they just rode with, which is where the heart is.
            */}
            {favourites.favourites.length > 0 ? (
              <Pressable
                onPress={() => setPreferFavouriteDrivers((on) => !on)}
                style={styles.favouriteRow}
                accessibilityRole="switch"
                accessibilityState={{ checked: preferFavouriteDrivers }}
              >
                <Feather name="heart" size={15} color={colors.fg} style={styles.noticeIcon} />
                <View style={styles.flex}>
                  <Text style={styles.favouriteLabel}>Ring my favourite drivers first</Text>
                  {/* Says what happens when they do NOT take it, because that is the question a
                      customer actually has about a switch like this. */}
                  <Text style={styles.favouriteHint}>
                    If none of them takes it, we look for everyone else straight away.
                  </Text>
                </View>
                <ToggleSwitch
                  value={preferFavouriteDrivers}
                  onChange={setPreferFavouriteDrivers}
                  accessibilityLabel="Ring my favourite drivers first"
                />
              </Pressable>
            ) : null}

            {/*
              THE ONE WARNING EVERY TRIP CARRIES EXCEPT THE INCITY 3-HOUR PACKAGE — this app's
              price never includes what the driver eats, or where they stay if the trip runs that
              long. Last before the button rather than folded into the breakdown: it is not a fare
              line, it is money that changes hands outside this app entirely, and burying it among
              rows that ARE in the total would read as if it were one of them.
            */}
            {needsAgreement ? (
              <Animated.View entering={FadeIn.duration(180)} style={styles.terms}>
                <View style={styles.termsHead}>
                  <Feather name="info" size={14} color={colors.muted} style={styles.noticeIcon} />
                  <View style={styles.flex}>
                    <Text style={styles.termsBody}>
                      This trip does not cover the driver&apos;s food, or a place to stay if it
                      runs that long. You will settle that directly with the driver, not through
                      the app.
                    </Text>
                    {/*
                      THE AMOUNTS LIVE IN THE FAQs, because they are not a fare line and nothing
                      here can quote them — an admin writes them down and both apps read the same
                      answer. Below the notice and above the checkbox on purpose: the agreement is
                      a gate, and a customer must not have to tap a link to find out what they are
                      agreeing to.
                    */}
                    <Pressable
                      onPress={() => router.push('/info/faqs')}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel="See the FAQs for what these costs usually come to"
                      style={({ pressed }) => [
                        styles.termsLinkRow,
                        pressed && styles.termsLinkPressed,
                      ]}
                    >
                      <Text style={styles.termsLink}>See FAQs for what these usually cost</Text>
                      <Feather name="chevron-right" size={13} color={colors.fg} />
                    </Pressable>
                  </View>
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
          </View>
        </ScrollView>
      )}

      {countdown.expired && card !== null ? (
        <PrimaryButton
          label="Get a new price"
          onPress={requote}
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
          onPress={requote}
          loading={query.isFetching}
          showArrow={false}
        />
      ) : unavailable !== null ? (
        <PrimaryButton label="Change the trip" onPress={onClose} showArrow={false} />
      ) : stage === 'fare' ? (
        <>
          {/*
            AN EXPLICIT CONTINUE, not "tapping a fare takes you on". Tapping a card is how the
            customer opens its breakdown to compare it against the one above — make that the same
            gesture that leaves the screen and comparing two fares becomes impossible.

            It carries the PAYABLE figure for the same reason the confirm button does: the number
            on a button has to be the number the customer is agreeing to.
          */}
          <PrimaryButton
            label={
              selected === null ? 'Continue' : `Continue · ${formatPaise(payablePaise)}`
            }
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setRequestedStage('details');
            }}
            disabled={selected === null || stale}
            showArrow
          />
          <Text style={styles.pending} numberOfLines={2}>
            {stale ? 'Getting you a fresh price…' : 'Next: your car, and who we ring first.'}
          </Text>
        </>
      ) : (
        <>
          <PrimaryButton
            label={
              quoteExpired
                ? 'Get a new price'
                : selected === null
                  ? 'Book ride'
                  : // The PAYABLE figure, not the fare — the button must not promise a price the
                    // wallet is about to change.
                    `Book ride · ${formatPaise(payablePaise)}`
            }
            onPress={() => {
              if (quoteExpired) {
                // A DIFFERENT ACTION WEARING THE SAME BUTTON, so the mutation's own failed state
                // must not follow it — otherwise the fresh price would render behind an error
                // banner for a booking attempt that has already been abandoned.
                confirmBooking.reset();
                requote();
                return;
              }
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              confirmBooking.mutate();
            }}
            loading={quoteExpired ? query.isFetching : confirmBooking.isPending}
            // Neither gate applies to "get a new price" — that tap is not the one the checkbox
            // or the car chips are about, and blocking it would trap a customer who has not yet
            // answered behind a stale price they cannot even refresh.
            disabled={quoteExpired ? false : !carChosen || (needsAgreement && !agreed)}
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
                : !carChosen
                  ? 'Tell us your car above, so we only ring drivers who can drive it.'
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
  pressedDim: { opacity: 0.6 },

  head: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md },
  headText: { flex: 1, paddingRight: space.sm },
  title: { ...text.heading, color: colors.fg },
  facts: { ...text.caption, color: colors.muted, marginTop: 2 },
  /** Sized like the timer chip opposite it, so the title stays optically centred between them. */
  back: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.xs,
    marginTop: -2,
  },
  backPressed: { opacity: 0.5 },

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

  /*
   * The wallet's effect on this trip, under the fare box. A bordered strip rather than another
   * card: it is an amendment to the price above it, not a new subject.
   */
  wallet: {
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    marginBottom: space.sm,
  },
  walletRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  walletLabel: { ...text.caption, color: colors.muted, flex: 1 },
  walletGood: { ...text.label, color: colors.success, fontFamily: fontFamily.semibold },
  walletBad: { ...text.label, color: colors.danger, fontFamily: fontFamily.semibold },

  // `maxHeight` is applied inline, from the window — see `listMaxHeight`.
  list: { marginBottom: space.sm },
  listContent: { paddingBottom: 2 },

  detail: { marginBottom: space.sm },
  detailContent: { paddingBottom: 2 },
  stale: { opacity: 0.45 },

  /** The way back to the prices, under the box it would replace. A link, not a second button. */
  changeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: space.xs,
    marginBottom: space.sm,
  },
  changeLinkText: { ...text.caption, color: colors.fg, textDecorationLine: 'underline' },

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

  favouriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.md,
    // Matching gaps on both sides. Without the bottom one this sat flush against whatever
    // followed — the terms block on most trips, and the button itself on the one fare with no
    // warning to show.
    marginTop: space.md,
    marginBottom: space.md,
    gap: space.sm,
  },
  favouriteLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },
  favouriteHint: { ...text.caption, color: colors.muted, marginTop: 2 },
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
  },
  termsHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.sm },
  /** No `flex` of its own any more — the shared `flex` style sits on the wrapper the notice text
      and its FAQ link now share. */
  termsBody: { ...text.caption, color: colors.muted },
  termsLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: space.xs },
  /** Underlined, not just coloured: on this sunken panel colour alone is not a strong enough cue. */
  termsLink: { ...text.caption, color: colors.fg, textDecorationLine: 'underline' },
  termsLinkPressed: { opacity: 0.6 },
  termsAgree: { ...text.caption, color: colors.fg },
});
