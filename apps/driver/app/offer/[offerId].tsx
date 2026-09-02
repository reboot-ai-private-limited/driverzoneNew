import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useOfferRing } from '@/features/offer/useOfferRing';
import { acceptOffer, declineOffer, getCurrentOffer } from '@/lib/api/endpoints/offers';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

/**
 * THE RINGING TRIP OFFER — the screen the whole driver app exists for.
 *
 * Full-bleed and outside the tab group on purpose: an offer is time-limited, and a tab bar is an
 * invitation to navigate away from the one thing that cannot wait.
 *
 * The countdown runs off the server's `expires_at` rather than a local timer started on mount.
 * A driver whose app was killed and reopened mid-offer must see the time that is actually left,
 * not a fresh 45 seconds — the server will lapse it on schedule regardless of what this screen
 * believes.
 */
export default function OfferScreen(): ReactElement {
  const { offerId } = useLocalSearchParams<{ offerId: string }>();
  const queryClient = useQueryClient();

  /**
   * The offer is re-read rather than passed in through params.
   *
   * It can arrive three ways — a poll on Home, an FCM tap while closed, a cold start into a live
   * offer — and only one of those could carry the payload. Reading it here means one code path
   * and no chance of rendering a stale copy of something the server has already superseded.
   */
  const current = useQuery({
    queryKey: keys.offers.current(),
    queryFn: ({ signal }) => getCurrentOffer(signal),
    // It is either ringing or it is not; a cached answer is worthless here.
    staleTime: 0,
  });

  const offer = current.data?.offer ?? null;
  const [outcome, setOutcome] = useState<string | null>(null);

  const accept = useMutation({
    mutationFn: () => acceptOffer(offerId),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: keys.offers.all() });

      if (!result.claimed) {
        /*
         * LOST THE RACE, and this is a normal outcome, not an error. Four of five drivers lose
         * every wave. The server's own wording is shown, briefly, then the screen closes — a
         * driver left staring at a dead offer learns to distrust the ring.
         */
        setOutcome(result.message);
        setTimeout(() => close(), 1800);
        return;
      }

      // TODO(S-17): route to the trip screen — /trip/[bookingId] — once it exists.
      setOutcome(`Trip ${result.reference} is yours.`);
      setTimeout(() => close(), 1800);
    },
    onError: (cause) => {
      setOutcome(cause instanceof Error ? cause.message : 'Could not accept this trip.');
    },
  });

  const decline = useMutation({
    mutationFn: () => declineOffer(offerId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.offers.all() });
      close();
    },
  });

  function close(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }

  /**
   * The offer vanished from under us — another driver won, the customer cancelled, or it lapsed.
   * Closing beats leaving a dead countdown on screen.
   */
  useEffect(() => {
    if (current.isSuccess && offer === null && outcome === null) close();
  }, [current.isSuccess, offer, outcome]);

  if (current.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brandOnFg} />
      </View>
    );
  }

  if (offer === null) {
    return (
      <View style={styles.loading}>
        <Text style={styles.outcome}>{outcome ?? 'This trip is no longer available.'}</Text>
      </View>
    );
  }

  /**
   * Ring while a live offer is on screen and unanswered.
   *
   * Gated on `outcome === null` as well as the offer existing, so the sound stops the instant
   * the driver acts rather than continuing through the 1.8s the result is shown — a phone still
   * ringing after you have accepted reads as the tap not having registered.
   */
  useOfferRing(offer !== null && outcome === null);

  const busy = accept.isPending || decline.isPending;

  return (
    <View style={styles.root}>
      <Countdown expiresAt={offer.expires_at} onExpire={close} />

      <View style={styles.card}>
        <Text style={styles.serviceType}>
          {offer.service_type === 'INCITY' ? 'In-city trip' : 'Outstation trip'}
        </Text>

        {/* The earning is the single most decision-relevant number, so it is the largest. */}
        <Text style={styles.earning}>{offer.earning.amount_display}</Text>
        <Text style={styles.earningLabel}>You earn</Text>

        <View style={styles.pickupRow}>
          <Feather name="map-pin" size={18} color={colors.fg} style={styles.pickupIcon} />
          <View style={styles.flex}>
            <Text style={styles.pickupLabel}>Pick up</Text>
            <Text style={styles.pickupAddress}>{offer.pickup.address}</Text>
          </View>
        </View>

        <Text style={styles.reference}>{offer.reference}</Text>
      </View>

      {outcome !== null ? (
        <Text style={styles.outcome} accessibilityLiveRegion="assertive">
          {outcome}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => accept.mutate()}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.accept, pressed && styles.pressed, busy && styles.inert]}
        >
          {accept.isPending ? (
            <ActivityIndicator color={colors.onFg} />
          ) : (
            <Text style={styles.acceptText}>Accept</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => decline.mutate()}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.decline, pressed && styles.pressed, busy && styles.inert]}
        >
          <Text style={styles.declineText}>Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The countdown, driven by the server's expiry.
 *
 * Recomputed from `Date.now()` every tick rather than decremented, so a JS thread stalled by a
 * slow render cannot make the clock drift away from the server's — which is the one that
 * actually lapses the offer.
 */
function Countdown({
  expiresAt,
  onExpire,
}: {
  expiresAt: string;
  onExpire: () => void;
}): ReactElement {
  const expiryMs = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000)),
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(timer);
        onExpire();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [expiryMs, onExpire]);

  return (
    <View style={styles.countdown}>
      <Text style={styles.countdownValue}>{remaining}</Text>
      <Text style={styles.countdownLabel}>seconds to respond</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.fg, padding: space.lg, justifyContent: 'center' },
  loading: {
    flex: 1,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  flex: { flex: 1 },

  countdown: { alignItems: 'center', marginBottom: space.lg },
  countdownValue: { fontSize: 64, lineHeight: 72, fontWeight: '800', color: colors.brandOnFg },
  countdownLabel: { ...text.body, color: colors.onFg, opacity: 0.7 },

  card: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.xl },
  serviceType: { ...text.label, color: colors.muted, textAlign: 'center' },
  earning: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: '800',
    color: colors.fg,
    textAlign: 'center',
    marginTop: space.xs,
  },
  earningLabel: { ...text.caption, color: colors.muted, textAlign: 'center' },

  pickupRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.lg },
  pickupIcon: { marginRight: space.sm, marginTop: 2 },
  pickupLabel: { ...text.caption, color: colors.muted },
  pickupAddress: { ...text.body, color: colors.fg },

  reference: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.lg },

  outcome: { ...text.body, color: colors.onFg, textAlign: 'center', marginTop: space.md },

  actions: { marginTop: space.xl, gap: space.sm },
  accept: {
    height: 60,
    borderRadius: radius.pill,
    backgroundColor: colors.dutyOn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: { fontSize: 19, fontWeight: '700', color: colors.onFg },
  decline: {
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.onFg,
    opacity: 0.7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: { ...text.body, color: colors.onFg },
  pressed: { opacity: 0.85 },
  inert: { opacity: 0.5 },
});
