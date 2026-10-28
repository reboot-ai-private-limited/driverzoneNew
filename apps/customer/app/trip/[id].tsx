import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import RazorpayCheckout from 'react-native-razorpay';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import type { BookingDto, BookingStatus, CancelBookingResponse } from '@driverzone/contracts';
import { AppIcon } from '@/components/AppIcon';
import { CancelRide } from '@/components/CancelRide';
import { DriverCard } from '@/components/DriverCard';
import { ExtendDayCard } from '@/components/ExtendDayCard';
import { FareBreakdown } from '@/components/FareBreakdown';
import { PrimaryButton } from '@/components/PrimaryButton';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { formatDuration, formatTime, formatWhen } from '@/features/booking/schedule';
import {
  hasDriverAssigned,
  isCustomerCancellable,
  isLiveStatus,
  isTerminalStatus,
  showsStartOtp,
  tripStatusCopy,
} from '@/features/booking/status';
import {
  getBooking,
  payTripExtras,
  selectPaymentMethod,
  verifyExtrasPayment,
  verifyPayment,
} from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * `RazorpayCheckout.open()`'s rejection is Razorpay Android's raw `PaymentData` JSON
 * (`RazorpayModule.onPaymentError`), not a message meant for a screen. Most of the time
 * `description` is a short human string ("Payment Cancelled"). For failures at the
 * payment_authentication step — including some cancellations, observed as
 * `BAD_REQUEST_ERROR` / `payment_error` — the Android SDK instead stuffs the ENTIRE nested
 * `{"error":{...}}` payload into that same `description` field as a string. Read literally, that
 * dumps raw JSON in the customer's face instead of an error; this drills into either shape and
 * always returns something a customer can read.
 */
function describeCheckoutError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'Payment was not completed.';
  const raw = error as { description?: unknown; error?: unknown };

  let nested = typeof raw.error === 'object' && raw.error !== null ? raw.error : null;
  if (nested === null && typeof raw.description === 'string' && raw.description.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw.description) as { error?: unknown };
      if (typeof parsed.error === 'object' && parsed.error !== null) nested = parsed.error;
    } catch {
      /* not JSON after all — falls through to the plain-string case below */
    }
  }

  if (nested !== null) {
    const reason = 'reason' in nested ? String((nested as { reason?: unknown }).reason) : null;
    return reason === 'payment_cancelled'
      ? 'You cancelled the payment.'
      : 'Your payment could not be completed.';
  }

  return typeof raw.description === 'string' && raw.description.length > 0
    ? raw.description
    : 'Payment was not completed.';
}

/**
 * The trip's own screen — reached from Confirm, and a ROUTE rather than a sheet.
 *
 * Every other booking surface in this app is a sheet over the map, deliberately, but a trip in
 * progress outlives that interaction: the customer backgrounds the app, gets a call, comes back
 * twenty minutes later expecting to see where things stand. A sheet lives inside `home.tsx`'s own
 * state and is gone the moment that screen unmounts; a route survives exactly the way the OS
 * itself expects a screen to.
 *
 * POLLS, does not push. Nothing server-side notifies this screen — there is no socket wired up
 * for the customer app yet — so `GET /customer/bookings/:id` is asked again on an interval, and
 * the interval stops itself once the trip reaches a status nothing follows.
 *
 * EVERY NUMBER HERE IS THE SERVER'S OWN. That once ruled out the driver card entirely — the DTO
 * carried an id and a name and nothing else. It now carries the photo, the rating and, WHILE THE
 * TRIP IS LIVE, the driver's phone number, so `DriverCard` renders all three and offers a call.
 *
 * The rule that replaced the old note is the server's, not this screen's: `driver.phone` is null
 * on a finished trip, so the call button disappears on its own when the trip ends. There is still
 * no vehicle list, because there is still nothing behind it to show.
 */
export default function TripScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();

  const booking = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: () => getBooking(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status !== undefined && isTerminalStatus(status) ? false : 4000;
    },
  });

  const [cancelling, setCancelling] = useState(false);
  const [lastCancel, setLastCancel] = useState<CancelBookingResponse | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [checkoutInFlight, setCheckoutInFlight] = useState(false);

  const data = booking.data;
  const copy = data === undefined ? null : tripStatusCopy(data.status);

  /*
   * OPENS THE REAL RAZORPAY CHECKOUT — the piece that was missing before: `selectPaymentMethod`
   * already creates a genuine order server-side, but nothing used to show the customer a way to
   * pay it. `order_id`/`key` come straight from that response's `client_token`/`public_key`.
   *
   * NEITHER `open()` RESOLVING NOR REJECTING IS TRUSTED AS PAYMENT CONFIRMATION. Only the
   * server-verified webhook is (`razorpay.gateway.ts`'s own doc comment says so) — this screen
   * already polls for that. A resolved checkout just means the customer did not back out, which
   * is worth an immediate look rather than waiting out the rest of the 4s poll; a rejected one
   * means they cancelled or it failed within the checkout itself, which is worth telling them.
   */
  const openCheckout = useCallback(
    async (order: {
      clientToken: string;
      publicKey: string;
      amountPaise: number;
      /**
       * Which endpoint confirms THIS order, and the only thing that differs between the fare's
       * checkout and the extra day's.
       *
       * A parameter rather than a second copy of this function: everything else here — the
       * Razorpay options, the deliberate refusal to treat a resolved `open()` as payment, the
       * error wording, the invalidation — is identical, and a duplicate would be one place for a
       * checkout bug to get fixed and another for it not to.
       */
      verify: (razorpayPaymentId: string, signature: string) => Promise<unknown>;
    }) => {
      setCheckoutInFlight(true);
      try {
        const result = await RazorpayCheckout.open({
          key: order.publicKey,
          amount: order.amountPaise,
          currency: 'INR',
          name: 'DriverZone',
          description: data === undefined ? 'Trip fare' : `Trip ${data.reference}`,
          order_id: order.clientToken,
          theme: { color: '#F2C200' },
        });

        /*
         * HANDS THE SIGNED RESULT BACK FOR SERVER-SIDE VERIFICATION, which is what lets the driver
         * end the trip within a second or two instead of whenever the webhook lands. Swallowed on
         * failure ON PURPOSE: this is an accelerant, not the confirmation. The webhook is still
         * coming and the 4s poll below still picks it up, so a failed verify means "wait a bit
         * longer", never "payment lost" — and telling the customer their payment failed here,
         * after they have actually paid, would be the worse lie.
         */
        try {
          await order.verify(result.razorpay_payment_id, result.razorpay_signature);
        } catch {
          /* the webhook remains the authority */
        }

        await queryClient.invalidateQueries({ queryKey: keys.bookings.detail(id) });
      } catch (error) {
        setPaymentError(`${describeCheckoutError(error)} You can try again.`);
      } finally {
        setCheckoutInFlight(false);
      }
    },
    [data, id, queryClient],
  );

  const selectMode = useMutation({
    mutationFn: (mode: 'CASH' | 'UPI') => selectPaymentMethod(id, mode, Crypto.randomUUID()),
    onMutate: () => setPaymentError(null),
    onSuccess: (result) => {
      queryClient.setQueryData(keys.bookings.detail(id), result.booking);
      if (result.client_token !== null && result.public_key !== null && result.amount !== null) {
        void openCheckout({
          clientToken: result.client_token,
          publicKey: result.public_key,
          amountPaise: result.amount.amount_paise,
          verify: (paymentId, signature) => verifyPayment(id, paymentId, signature),
        });
      }
    },
    onError: (err) => {
      setPaymentError(err instanceof Error ? err.message : 'Could not set payment method');
    },
  });

  /**
   * Paying for an extra day the driver agreed to, after the trip itself was already paid for.
   *
   * ITS OWN ORDER AND ITS OWN CHECKOUT — see `payTripExtras`. The trip cannot end until this
   * clears, which is why it is a button on this screen rather than something tidied away into the
   * final receipt: the driver is standing there waiting for it.
   */
  const payExtras = useMutation({
    mutationFn: () => payTripExtras(id),
    onMutate: () => setPaymentError(null),
    onSuccess: (order) => {
      if (order.client_token === null || order.public_key === null) return;
      void openCheckout({
        clientToken: order.client_token,
        publicKey: order.public_key,
        amountPaise: order.amount.amount_paise,
        verify: (paymentId, signature) =>
          verifyExtrasPayment(id, order.payment_id, paymentId, signature),
      });
    },
    onError: (err) => {
      setPaymentError(err instanceof Error ? err.message : 'Could not start the payment');
    },
  });

  /*
   * COMING BACK FROM WHEREVER WE WENT — most often GPay or Paytm mid-UPI-payment, since Razorpay's
   * UPI Intent flow hands off to whichever app the customer picked and this screen is only
   * backgrounded, never unmounted, while that happens (this effect existing at all is the
   * confirmation of that: an unmounted screen has no `AppState` listener left to fire). The 4s
   * poll would eventually notice a captured payment on its own; this removes the wait the moment
   * the customer's thumb is back on this app, rather than leaving them staring at a stale "pending"
   * badge for up to 4 seconds after switching back.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void queryClient.invalidateQueries({ queryKey: keys.bookings.detail(id) });
      }
    });
    return () => subscription.remove();
  }, [id, queryClient]);

  /*
   * BLOCKS THE HARDWARE BACK BUTTON while a checkout is actually open. Android's back gesture is
   * otherwise free to pop this screen mid-payment, which — however briefly, before Razorpay's own
   * activity has focus — would unmount the very screen `openCheckout`'s promise is about to
   * resolve into. `true` here means "handled, do nothing", which is exactly what suppresses it.
   */
  useEffect(() => {
    if (!checkoutInFlight) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [checkoutInFlight]);

  /*
   * THE RATE-YOUR-DRIVER HANDOFF, and ONLY on a transition witnessed in this session. `previous`
   * starts `undefined` and is set on every render that has data — so a customer who opens an
   * already-COMPLETED booking cold (from a fresh app launch, say) never gets shoved into rating a
   * trip they may have already rated or skipped. It fires exactly once: the poll that first
   * observes STARTED → COMPLETED while this screen happens to be open and watching.
   */
  const previousStatus = useRef<BookingStatus | undefined>(undefined);
  useEffect(() => {
    if (data === undefined) return;
    if (
      previousStatus.current !== undefined &&
      previousStatus.current !== 'COMPLETED' &&
      data.status === 'COMPLETED'
    ) {
      router.replace(`/rate/${id}`);
    }
    previousStatus.current = data.status;
  }, [data, id]);

  return (
    <View style={styles.root}>
      {/*
        THE YELLOW BAND is the one piece of chrome this screen borrows from the reference design —
        everything under it is rebuilt from what `BookingDto` actually carries.
      */}
      <View style={styles.header}>
        <Pressable
          // Disabled mid-checkout for the same reason the hardware back button is blocked above —
          // this is the app-level equivalent of that same guard.
          onPress={() => (checkoutInFlight ? undefined : router.replace('/home'))}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back to home"
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {data?.reference ?? 'Your trip'}
          </Text>
          {copy === null ? null : (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {copy.title}
            </Text>
          )}
        </View>
        <View style={styles.back} />
      </View>

      {booking.isPending ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : booking.isError ? (
        <View style={styles.centre}>
          <Text style={styles.loadError}>We could not load this trip.</Text>
          <Pressable
            onPress={() => void booking.refetch()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Feather name="refresh-cw" size={15} color={colors.fg} />
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : data === undefined || copy === null ? null : (
        <>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            {lastCancel === null ? null : (
              <Animated.View entering={FadeIn.duration(180)} style={styles.cancelResult}>
                <Feather name="check-circle" size={16} color={colors.fg} style={styles.rowIcon} />
                <Text style={styles.cancelResultText}>
                  Trip cancelled.{' '}
                  {lastCancel.fee.amount_paise > 0
                    ? `A ${lastCancel.fee.amount_display} cancellation fee applies.`
                    : 'No fee was charged.'}
                </Text>
              </Animated.View>
            )}

            <Stagger index={0}>
              <StatusCard booking={data} />
            </Stagger>

            {showsStartOtp(data.status) && data.start_otp !== null ? (
              <Stagger index={1}>
                <View style={styles.otpCard}>
                  <Text style={styles.otpLabel}>Your trip code</Text>
                  <OtpDigits code={data.start_otp} />
                  <Text style={styles.otpHint}>
                    {data.rider === null
                      ? 'Read this to your driver to start the ride.'
                      : `Share this code with ${data.rider.name} — they read it to the driver to start the ride.`}
                  </Text>
                </View>
              </Stagger>
            ) : null}

            {data.driver === null ? null : (
              <Stagger index={2}>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Your driver</Text>
                  {/* Only once the trip is over: a favourite needs a completed trip behind it,
                      which is the same rule the API enforces. */}
                  <DriverCard driver={data.driver} favouritable={data.status === 'COMPLETED'} />
                </View>
              </Stagger>
            )}

            {/* Above the booking details, because it is an ACTION on a live trip and those are a
                read-only record of one. Renders nothing at all when there is nothing to say. */}
            <Stagger index={3}>
              <ExtendDayCard booking={data} />
            </Stagger>

            <Stagger index={4}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Booking details</Text>
                <DetailRow
                  icon="package"
                  label="Package"
                  value={data.fare.lines[0]?.label ?? data.service_type}
                />
                <DetailRow icon="map-pin" label="Pickup" value={data.pickup.address} />
                <DetailRow
                  icon="flag"
                  label="Destination"
                  value={data.drop.address}
                  last={data.car_plate === null && data.rider === null}
                />
                {data.car_plate === null ? null : (
                  <DetailRow icon="truck" label="Your car" value={data.car_plate} last={data.rider === null} />
                )}
                {data.rider === null ? null : (
                  <DetailRow
                    icon="user"
                    label="Booked for"
                    value={
                      data.rider.phone === null
                        ? data.rider.name
                        : `${data.rider.name} · ${formatForDisplay(data.rider.phone)}`
                    }
                    last
                  />
                )}
              </View>
            </Stagger>

            {/*
              WHEN — booked for, started, ended, and how long it took. Each row appears once it
              has happened; a running trip shows how long it has been going so far.
            */}
            <Stagger index={4}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Trip time</Text>
                <DetailRow
                  icon="calendar"
                  label="Pickup time"
                  value={formatWhen(new Date(data.scheduled_at))}
                  last={data.timestamps.started_at === null}
                />
                {data.timestamps.started_at === null ? null : (
                  <DetailRow
                    icon="play"
                    label="Started"
                    value={formatWhen(new Date(data.timestamps.started_at))}
                  />
                )}
                {data.timestamps.completed_at === null ? null : (
                  <DetailRow
                    icon="square"
                    label="Ended"
                    value={formatWhen(new Date(data.timestamps.completed_at))}
                  />
                )}
                {data.timestamps.started_at === null ? null : (
                  <DetailRow
                    icon="clock"
                    label={data.timestamps.completed_at === null ? 'So far' : 'Duration'}
                    value={formatDuration(
                      new Date(data.timestamps.started_at),
                      data.timestamps.completed_at === null
                        ? new Date()
                        : new Date(data.timestamps.completed_at),
                    )}
                    last
                  />
                )}
              </View>
            </Stagger>

            <Stagger index={5}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Trip progress</Text>
                <ProgressTimeline booking={data} />
              </View>
            </Stagger>

            <Stagger index={6}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Fare breakdown</Text>
                {/* The same breakdown the ride receipt shows — one component, so they agree. */}
                <FareBreakdown booking={data} />

                {/*
                  THE EXTRA DAY'S OWN CHECKOUT. `outstanding` is non-zero only when the driver has
                  accepted a day that the trip's own order did not cover. Online is one way to pay
                  it; cash to the driver is always the other (2026-10-13), so this never blocks.
                */}
                {data.payable.outstanding.amount_paise > 0 ? (
                  <View style={styles.paymentBox}>
                    <View style={styles.rule} />
                    <Text style={styles.paymentHeading}>Pay for your extra day</Text>
                    <Text style={styles.paymentSubtext}>
                      Your driver agreed to stay on. Pay online now, or pay your driver in cash at
                      the end of the trip.
                    </Text>
                    {paymentError !== null ? (
                      <Text style={styles.paymentError}>{paymentError}</Text>
                    ) : null}
                    <PrimaryButton
                      label={`Pay ${data.payable.outstanding.amount_display}`}
                      onPress={() => payExtras.mutate()}
                      loading={payExtras.isPending || checkoutInFlight}
                      showArrow={false}
                    />
                  </View>
                ) : null}
                {data.status === 'STARTED' && data.payment_mode === null ? (
                  <View style={styles.paymentBox}>
                    <View style={styles.rule} />
                    <Text style={styles.paymentHeading}>How would you like to pay?</Text>
                    <Text style={styles.paymentSubtext}>
                      Select a payment method before you reach your destination.
                    </Text>
                    {paymentError !== null ? (
                      <Text style={styles.paymentError}>{paymentError}</Text>
                    ) : null}
                    <View style={styles.payActions}>
                      <Pressable
                        onPress={() => selectMode.mutate('CASH')}
                        disabled={(selectMode.isPending || checkoutInFlight)}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.payBtn,
                          pressed && styles.payBtnPressed,
                          (selectMode.isPending || checkoutInFlight) && styles.payBtnDisabled,
                        ]}
                      >
                        <AppIcon name="rupee" size={16} color={colors.fg} />
                        <Text style={styles.payBtnText}>Pay Cash</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => selectMode.mutate('UPI')}
                        disabled={(selectMode.isPending || checkoutInFlight)}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.payBtnOnline,
                          pressed && styles.payBtnPressed,
                          (selectMode.isPending || checkoutInFlight) && styles.payBtnDisabled,
                        ]}
                      >
                        <Feather name="credit-card" size={16} color={colors.fg} />
                        <Text style={styles.payBtnOnlineText}>Pay Online</Text>
                      </Pressable>
                    </View>
                    {selectMode.isPending || checkoutInFlight ? (
                      <View style={styles.payPendingRow}>
                        <ActivityIndicator size="small" color={colors.fg} />
                        <Text style={styles.payPendingText}>
                          {checkoutInFlight ? 'Waiting for checkout…' : 'Setting up payment…'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {data.payment_mode === null && data.status !== 'STARTED' ? (
                  <Text style={styles.cashNote}>
                    You can choose how to pay once the driver starts the trip.
                  </Text>
                ) : null}

                {/*
                  PREPAID — booked and paid through our team. Nothing to choose and nothing to pay
                  for the fare; only extras that build up during the trip are still due.
                */}
                {data.payment_mode === 'PREPAID' ? (
                  <View style={styles.paymentBadgeSuccess}>
                    <Feather name="check-circle" size={16} color="#16a34a" />
                    <View style={styles.flex}>
                      <Text style={styles.paymentSuccessTitle}>Prepaid</Text>
                      <Text style={styles.paymentSuccessBody}>
                        Your fare is already paid. Any waiting time or extra day is paid to your
                        driver in cash, or online, at the end.
                      </Text>
                    </View>
                  </View>
                ) : null}

                {data.payment_mode === 'CASH' ? (
                  <View style={styles.paymentNoteCash}>
                    <Feather name="info" size={15} color={colors.muted} />
                    <View style={styles.flex}>
                      <Text style={styles.cashNoteText}>
                        Pay the driver in cash at the end of your trip.
                      </Text>
                      {data.status === 'STARTED' ? (
                        <Pressable
                          onPress={() => selectMode.mutate('UPI')}
                          disabled={(selectMode.isPending || checkoutInFlight)}
                          hitSlop={6}
                          style={styles.switchLink}
                        >
                          <Text style={styles.switchLinkText}>Or pay online via Razorpay</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                ) : null}

                {data.payment_mode === 'UPI' && data.payment_status === 'PAID' ? (
                  <View style={styles.paymentBadgeSuccess}>
                    <Feather name="check-circle" size={16} color="#16a34a" />
                    <View style={styles.flex}>
                      <Text style={styles.paymentSuccessTitle}>Paid Online</Text>
                      <Text style={styles.paymentSuccessBody}>
                        Your payment was received. Driver can complete the trip upon arrival.
                      </Text>
                    </View>
                  </View>
                ) : null}

                {data.payment_mode === 'UPI' && data.payment_status !== 'PAID' ? (
                  <View style={styles.paymentBadgePending}>
                    <Feather name="clock" size={16} color="#ca8a04" />
                    <View style={styles.flex}>
                      <Text style={styles.paymentPendingTitle}>Online payment pending</Text>
                      <Text style={styles.paymentPendingBody}>
                        Waiting for payment confirmation. The driver cannot end the trip until this clears.
                      </Text>
                      {paymentError !== null ? (
                        <Text style={styles.paymentError}>{paymentError}</Text>
                      ) : null}
                      {data.status === 'STARTED' ? (
                        <>
                          {/* Reopens the SAME order — `selectPaymentMethod` is idempotent on an
                              already-chosen mode and hands back the existing order id, so a
                              dismissed or interrupted checkout is one tap from resuming. */}
                          <Pressable
                            onPress={() => selectMode.mutate('UPI')}
                            disabled={(selectMode.isPending || checkoutInFlight)}
                            accessibilityRole="button"
                            style={({ pressed }) => [
                              styles.retryPayBtn,
                              pressed && styles.payBtnPressed,
                              (selectMode.isPending || checkoutInFlight) && styles.payBtnDisabled,
                            ]}
                          >
                            <Feather name="refresh-cw" size={15} color={colors.fg} />
                            <Text style={styles.payBtnOnlineText}>Retry payment</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => selectMode.mutate('CASH')}
                            disabled={(selectMode.isPending || checkoutInFlight)}
                            hitSlop={6}
                            style={styles.switchLink}
                          >
                            <Text style={styles.switchLinkText}>Or switch to cash payment</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  </View>
                ) : null}
              </View>
            </Stagger>
          </ScrollView>

          {isCustomerCancellable(data.status) ? (
            <Pressable
              onPress={() => setCancelling(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.cancelBar, pressed && styles.cancelBarPressed]}
            >
              <View>
                <Text style={styles.cancelBarLabel}>Cancel trip</Text>
                <Text style={styles.cancelBarHint}>Need to cancel this trip?</Text>
              </View>
              <Feather name="chevron-right" size={20} color={colors.brand} />
            </Pressable>
          ) : isTerminalStatus(data.status) ? (
            <View style={styles.doneWrap}>
              <PrimaryButton
                label="Done"
                onPress={() => router.replace('/home')}
                showArrow={false}
              />
            </View>
          ) : null}
        </>
      )}

      <CancelRide
        visible={cancelling}
        bookingId={id}
        driverAssigned={data !== undefined && hasDriverAssigned(data.status)}
        onClose={() => setCancelling(false)}
        onCancelled={(result) => {
          setCancelling(false);
          setLastCancel(result);
          queryClient.setQueryData(keys.bookings.detail(id), result.booking);
        }}
      />
    </View>
  );
}

/** A staggered rise on first paint — every card on this screen uses it, in reading order. */
function Stagger({ index, children }: { index: number; children: ReactNode }): ReactElement {
  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(220)}>{children}</Animated.View>
  );
}

/**
 * The trip code, as four boxes rather than one letter-spaced string — the same visual language
 * `OtpInput` uses to COLLECT a code at login, reused here to DISPLAY one. Read-only: there is
 * nothing to type, this is what the customer reads aloud.
 */
function OtpDigits({ code }: { code: string }): ReactElement {
  return (
    <View style={styles.otpRow}>
      {code.split('').map((digit, index) => (
        // eslint-disable-next-line react/no-array-index-key -- a fixed 4-digit code has no stable identity per cell besides position
        <View key={index} style={styles.otpCell}>
          <Text style={styles.otpDigit}>{digit}</Text>
        </View>
      ))}
    </View>
  );
}

function StatusCard({ booking }: { booking: BookingDto }): ReactElement {
  /*
   * A SCHEDULED BOOKING WAITING ITS TURN GETS ITS OWN WORDS, because `tripStatusCopy`'s CONFIRMED
   * line — "We're about to start looking for a driver" — is true for a trip leaving in ten minutes
   * and false for days on one booked for next Tuesday. A customer reading "about to" and then
   * watching nothing happen for three days has every reason to think the app is broken, which is
   * exactly the report this came from.
   *
   * NAMES BOTH INSTANTS. The pickup answers "did it save the time I chose", and `dispatch_at` —
   * derived server-side from the lead-time setting, so this screen never hardcodes 90 minutes —
   * answers the question that was unanswerable before: when does anything start happening.
   */
  const waitingForDispatch = booking.is_scheduled && booking.status === 'CONFIRMED';

  const copy = waitingForDispatch
    ? {
        ...tripStatusCopy(booking.status),
        title: `Booked for ${formatWhen(new Date(booking.scheduled_at))}`,
        body: `We start looking for your driver at ${formatWhen(new Date(booking.dispatch_at))}. You can cancel free until then.`,
      }
    : tripStatusCopy(booking.status);

  /*
   * "INCLUDED UNTIL", NOT "ESTIMATED COMPLETION" — there is no overage in this product any more
   * (`computeIncityFare`'s own doc: the quoted total IS the total), so a trip running past this
   * instant costs nothing extra and may perfectly well still be going. Calling it a completion
   * estimate would claim a forecast this app has no basis for; this is the one fact that IS
   * exact — the minute the included time runs out — read straight off `startedAt +
   * includedMinutes`, both of which are real, stored values.
   */
  const includedUntil =
    booking.status === 'STARTED' &&
    booking.included_minutes !== null &&
    booking.timestamps.started_at !== null
      ? new Date(
          new Date(booking.timestamps.started_at).getTime() + booking.included_minutes * 60_000,
        )
      : null;

  return (
    <View style={styles.statusCard}>
      <View style={styles.statusRow}>
        {/* Still, not pulsing, while a scheduled booking waits: the pulse means "something is
            happening right now", and for the next three days nothing is. */}
        <StatusIcon icon={copy.icon} live={isLiveStatus(booking.status) && !waitingForDispatch} />
        <View style={styles.flex}>
          <Text style={styles.statusLabel}>Current status</Text>
          <Text style={styles.statusTitle}>{copy.title}</Text>
          {copy.body.length === 0 ? null : <Text style={styles.statusBody}>{copy.body}</Text>}
        </View>
      </View>

      {/*
        HOW LONG UNTIL THE DRIVER IS HERE — the question a customer standing outside is actually
        asking, and one this screen could not answer at all until now.

        **DELIBERATELY APPROXIMATE, AND IT SAYS SO.** The tilde is not decoration: the server
        derives this from the driver's last reported position and a road estimate, so "8 min"
        would claim a precision nothing behind it has. It is minutes-away rather than a clock
        time for the same reason — "arriving 6:42 pm" is a promise, "~8 min" is an expectation,
        and only one of those is honest about what it knows.

        NOT A COUNTDOWN. It does not tick. The value refreshes on the 4s poll that drives this
        whole screen, and animating it downward between polls would invent seconds of precision
        out of a number that is already up to a minute old.

        SILENT WHEN NULL, which is most of a trip — no driver yet, already arrived, a stale fix.
        The row simply is not rendered and the status title above carries the screen;
        `pickup_eta_minutes` documents each case the server declines to answer.
      */}
      {booking.pickup_eta_minutes === null ? null : (
        <View style={styles.statusStat}>
          <View style={styles.statusStatIcon}>
            <Feather name="navigation" size={13} color={colors.muted} />
          </View>
          <View>
            <Text style={styles.statusStatLabel}>Arriving in about</Text>
            <Text style={styles.statusStatValue}>~{booking.pickup_eta_minutes} min</Text>
          </View>
        </View>
      )}

      {includedUntil === null ? null : (
        <View style={styles.statusStat}>
          <View style={styles.statusStatIcon}>
            <Feather name="clock" size={13} color={colors.muted} />
          </View>
          <View>
            <Text style={styles.statusStatLabel}>Included until</Text>
            <Text style={styles.statusStatValue}>{formatTime(includedUntil)}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

/**
 * A soft pulsing ring behind the icon while something is actually IN MOTION — a still icon next
 * to "Finding your driver" reads as the app having stalled, the way a spinner-less loading screen
 * always does. Held perfectly still for a terminal status, where nothing is happening any more
 * and a pulse would be a lie about that.
 */
function StatusIcon({ icon, live }: { icon: FeatherName; live: boolean }): ReactElement {
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (live) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 1400, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      );
    } else {
      pulse.value = 0;
    }
  }, [live, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: live ? 0.35 * (1 - pulse.value) : 0,
    transform: [{ scale: 1 + pulse.value * 0.45 }],
  }));

  return (
    <View style={styles.statusIconWrap}>
      <Animated.View style={[styles.statusIconRing, ringStyle]} />
      <View style={styles.statusIcon}>
        <Feather name={icon} size={22} color={colors.fg} />
      </View>
    </View>
  );
}

interface Milestone {
  key: string;
  label: string;
  at: string | null;
}

/**
 * The real stages, in the order the state machine actually allows them (`booking.entity.ts`'s
 * `TRANSITIONS`). Every timestamp here is one `BookingDto.timestamps` already carries — nothing
 * is estimated or interpolated between two real points.
 */
function ProgressTimeline({ booking }: { booking: BookingDto }): ReactElement {
  const { timestamps, status } = booking;

  const cancelledOrExpired =
    timestamps.cancelled_at !== null || status === 'NO_DRIVER_FOUND' || status === 'EXPIRED';

  const milestones: Milestone[] = [
    { key: 'assigned', label: 'Driver assigned', at: timestamps.assigned_at },
    { key: 'en_route', label: 'Driver on the way', at: timestamps.en_route_at },
    { key: 'arrived', label: 'Driver arrived', at: timestamps.arrived_at },
    { key: 'started', label: 'Trip started', at: timestamps.started_at },
    ...(cancelledOrExpired
      ? []
      : [{ key: 'completed', label: 'Trip complete', at: timestamps.completed_at }]),
  ];

  /*
   * THREE STATES, NOT TWO. A step neither reached yet nor merely "someday" — it is what happens
   * NEXT — is real information this booking's own status already answers, not a guess: it is the
   * first unreached milestone, and only while the trip is still live at all. A pending step on a
   * dead-ended booking (NO_DRIVER_FOUND, EXPIRED) has no "next" to be, which is exactly what
   * `cancelledOrExpired` already tracks for the row below.
   */
  const currentIndex = cancelledOrExpired
    ? -1
    : milestones.findIndex((milestone) => milestone.at === null);

  return (
    <View>
      {milestones.map((milestone, index) => {
        const reached = milestone.at !== null;
        const isCurrent = !reached && index === currentIndex;
        const isLast = index === milestones.length - 1 && !cancelledOrExpired;
        return (
          <View key={milestone.key} style={styles.timelineRow}>
            <View style={styles.timelineMarkerCol}>
              <View
                style={[
                  styles.timelineDot,
                  reached && styles.timelineDotDone,
                  isCurrent && styles.timelineDotCurrent,
                ]}
              >
                {reached ? <Feather name="check" size={11} color={colors.brandOnFg} /> : null}
              </View>
              {isLast ? null : (
                <View style={[styles.timelineLine, reached && styles.timelineLineDone]} />
              )}
            </View>
            <View style={styles.timelineText}>
              <Text
                style={[styles.timelineLabel, (reached || isCurrent) && styles.timelineLabelDone]}
              >
                {milestone.label}
              </Text>
              <Text style={[styles.timelineTime, isCurrent && styles.timelineTimeCurrent]}>
                {milestone.at !== null
                  ? formatTime(new Date(milestone.at))
                  : isCurrent
                    ? 'Next up'
                    : 'Pending'}
              </Text>
            </View>
          </View>
        );
      })}

      {cancelledOrExpired ? (
        <View style={styles.timelineRow}>
          <View style={styles.timelineMarkerCol}>
            <View style={[styles.timelineDot, styles.timelineDotBad]}>
              <Feather name="x" size={11} color={colors.card} />
            </View>
          </View>
          <View style={styles.timelineText}>
            <Text style={[styles.timelineLabel, styles.timelineLabelBad]}>
              {tripStatusCopy(status).title}
            </Text>
            <Text style={styles.timelineTime}>
              {timestamps.cancelled_at === null
                ? '—'
                : formatTime(new Date(timestamps.cancelled_at))}
            </Text>
            {booking.cancellation_reason === null ? null : (
              <Text style={styles.timelineReason}>{booking.cancellation_reason}</Text>
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  last = false,
  plain = false,
}: {
  icon?: FeatherName;
  label: string;
  value: string;
  last?: boolean;
  plain?: boolean;
}): ReactElement {
  return (
    <View style={[styles.detailRow, last && styles.detailRowLast]}>
      {icon === undefined || plain ? (
        <View style={styles.detailIconSlot} />
      ) : (
        <View style={styles.detailIconBubble}>
          <Feather name={icon} size={13} color={colors.fg} />
        </View>
      )}
      <Text style={[styles.detailLabel, plain && styles.detailLabelPlain]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
    // Lifts it off the scroll content beneath, the same way `card` lifts off `bg` — without
    // this the rounded corners just sit flush and read as a colour change, not a surface.
    ...shadow.card,
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSubtitle: { ...text.caption, color: colors.fg, opacity: 0.7, marginTop: 1 },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  loadError: { ...text.body, color: colors.muted, marginBottom: space.md },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryPressed: { backgroundColor: colors.bgSunken },
  retryLabel: { ...text.label, color: colors.fg },

  content: { padding: space.lg, paddingBottom: space.xl },

  cancelResult: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.md,
  },
  cancelResultText: { ...text.caption, color: colors.fg, flex: 1 },
  rowIcon: { marginRight: space.sm, marginTop: 1 },

  statusCard: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center' },
  statusIconWrap: {
    width: 48,
    height: 48,
    marginRight: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusIconRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  statusIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.soft,
  },
  statusLabel: { ...text.caption, color: colors.muted },
  statusTitle: { ...text.heading, color: colors.fg, marginTop: 1 },
  statusBody: { ...text.caption, color: colors.muted, marginTop: 2 },
  statusStat: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  statusStatIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  statusStatLabel: { ...text.caption, color: colors.muted },
  statusStatValue: {
    ...text.label,
    color: colors.fg,
    fontFamily: fontFamily.semibold,
    marginTop: 1,
  },

  otpCard: {
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
  },
  otpLabel: { ...text.label, color: colors.muted, marginBottom: space.sm },
  otpRow: { flexDirection: 'row', gap: space.sm },
  otpCell: {
    width: 44,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigit: { fontSize: 22, fontFamily: fontFamily.bold, color: colors.fg },
  otpHint: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.sm },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.soft,
  },
  cardTitle: { ...text.label, color: colors.fg, marginBottom: space.sm },

  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailIconSlot: { width: 26, marginRight: space.sm },
  detailIconBubble: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  detailLabel: { ...text.caption, color: colors.muted, width: 80 },
  detailLabelPlain: { color: colors.muted },
  detailValue: { ...text.body, color: colors.fg, flex: 1, textAlign: 'right' },

  timelineRow: { flexDirection: 'row' },
  timelineMarkerCol: { alignItems: 'center', width: 24 },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotDone: { backgroundColor: colors.fg, borderColor: colors.fg },
  // Yellow, not ink — a THIRD colour for a third state. Reusing the "done" fill for "next up"
  // would say a step already happened; reusing the pending grey would erase the distinction this
  // whole block exists to draw.
  timelineDotCurrent: { backgroundColor: colors.brand, borderColor: colors.brand },
  timelineDotBad: { backgroundColor: colors.danger, borderColor: colors.danger },
  timelineLine: { width: 2, flex: 1, minHeight: 22, backgroundColor: colors.border },
  timelineLineDone: { backgroundColor: colors.fg },
  timelineText: { flex: 1, paddingBottom: space.md, paddingLeft: space.sm },
  timelineLabel: { ...text.body, color: colors.faint },
  timelineLabelDone: { color: colors.fg, fontFamily: fontFamily.semibold },
  timelineLabelBad: { color: colors.danger, fontFamily: fontFamily.semibold },
  timelineTime: { ...text.caption, color: colors.faint, marginTop: 1 },
  timelineTimeCurrent: { color: colors.fg, fontFamily: fontFamily.semibold },
  timelineReason: { ...text.caption, color: colors.muted, marginTop: 2 },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },
  cashNote: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.md },

  paymentBox: { marginTop: space.sm },
  paymentHeading: {
    ...text.label,
    color: colors.fg,
    fontFamily: fontFamily.bold,
    marginTop: space.xs,
  },
  paymentSubtext: { ...text.caption, color: colors.muted, marginTop: 2, marginBottom: space.sm },
  paymentError: { ...text.caption, color: colors.danger, marginBottom: space.xs },
  payActions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  payBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  payBtnOnline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  // Full width rather than half: unlike the Cash/Online pair it has no sibling to share a row
  // with, and it is the action this block exists to offer.
  retryPayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    marginTop: space.sm,
  },
  payBtnPressed: { opacity: 0.8 },
  payBtnDisabled: { opacity: 0.5 },
  payBtnText: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },
  payBtnOnlineText: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  payPendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    marginTop: space.sm,
  },
  payPendingText: { ...text.caption, color: colors.muted },

  paymentNoteCash: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.md,
  },
  cashNoteText: { ...text.caption, color: colors.fg, flex: 1 },
  switchLink: { marginTop: 4 },
  switchLinkText: {
    ...text.caption,
    color: colors.fg,
    textDecorationLine: 'underline',
    fontFamily: fontFamily.semibold,
  },

  paymentBadgeSuccess: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.md,
  },
  paymentSuccessTitle: { ...text.label, color: '#166534', fontFamily: fontFamily.bold },
  paymentSuccessBody: { ...text.caption, color: '#15803D', marginTop: 2 },

  paymentBadgePending: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    backgroundColor: '#FEFCE8',
    borderWidth: 1,
    borderColor: '#FEF08A',
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.md,
  },
  paymentPendingTitle: { ...text.label, color: '#854D0E', fontFamily: fontFamily.bold },
  paymentPendingBody: { ...text.caption, color: '#A16207', marginTop: 2 },

  cancelBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.fg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  cancelBarPressed: { opacity: 0.85 },
  cancelBarLabel: { ...text.label, color: colors.brand, fontFamily: fontFamily.bold },
  cancelBarHint: { ...text.caption, color: colors.onFg, opacity: 0.7, marginTop: 1 },

  doneWrap: { padding: space.lg },
});
