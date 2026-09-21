import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { OtherOffersSheet } from '@/components/OtherOffersSheet';
import {
  markOfferScreenClosed,
  markOfferScreenOpen,
  offerHref,
} from '@/features/offer/openOffer';
import { useOfferRing } from '@/features/offer/useOfferRing';
import { pushLog } from '@/notifications/log';
import { formatWhen } from '@/features/trips/scheduledWhen';
import { acceptOffer, declineOffer, listOffers } from '@/lib/api/endpoints/offers';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

/**
 * THE RINGING TRIP OFFER — the screen the whole driver app exists for.
 *
 * Full-bleed and outside the tab group on purpose: an offer is time-limited, and a tab bar is an
 * invitation to navigate away from the one thing that cannot wait.
 *
 * **Read at arm's length, under time pressure, often from a parked-but-about-to-move car.** Every
 * layout decision below follows from that: the earning is the largest thing on screen because it
 * is the whole decision, the countdown is a draining BAR as well as a number because a shrinking
 * bar is readable in peripheral vision where a digit is not, and Accept carries twice the visual
 * weight of Decline because the app should never make taking work the harder tap.
 *
 * The countdown runs off the server's `expires_at` rather than a local timer started on mount.
 * A driver whose app was killed and reopened mid-offer must see the time that is actually left,
 * not a fresh 45 seconds — the server will lapse it on schedule regardless of what this screen
 * believes.
 *
 * **The drop address IS here now (2026-09-04).** `DriverOfferDto` carries `drop` alongside
 * `pickup`, because "where does this trip go" changes the accept decision as much as the earning
 * does — an outstation drop 200 km out and one two streets over read identically without it.
 *
 * **A driver can hold more than one live offer at once (2026-09-04).** Two customers booking
 * near-simultaneously can both dispatch to the same driver, and dispatch's matching does not
 * exclude that — deliberately, so this screen is what actually handles it. It fetches the FULL
 * live list (`GET /driver/offers`, soonest-expiring first) rather than a single "current" offer,
 * shows and acts on THIS SCREEN'S OWN `offerId` from that list — never an arbitrary other one —
 * and surfaces every other live offer as a "+N more waiting" banner. Resolving this one advances
 * straight to the next queued offer if any remain, rather than dropping back to Home and making
 * the driver wait for the next poll to be told about a request that was already ringing.
 */
export default function OfferScreen(): ReactElement {
  const { offerId } = useLocalSearchParams<{ offerId: string }>();
  const queryClient = useQueryClient();

  /**
   * The whole live list is re-read rather than a single offer passed in through params.
   *
   * It can arrive three ways — a poll on Home, an FCM tap while closed, a cold start into a live
   * offer — and only one of those could carry a payload, and even that payload would only ever be
   * for the ONE offer that triggered it. Reading the full list here is what lets this screen also
   * answer "what else is ringing right now," which a single passed-in offer never could.
   */
  const list = useQuery({
    queryKey: keys.offers.list(),
    queryFn: ({ signal }) => listOffers(signal),
    // It is either ringing or it is not; a cached answer is worthless here.
    staleTime: 0,
    refetchInterval: 4000,
  });

  /*
   * THE FIX FOR THE ORIGINAL MISMATCH BUG: found by THIS SCREEN'S OWN `offerId`, never by
   * picking an arbitrary entry. Accept and Decline below act on this exact object's id, so what
   * is on screen and what a tap submits can no longer be two different offers.
   */
  const offer = list.data?.offers.find((candidate) => candidate.offer_id === offerId) ?? null;
  const others = useMemo(
    () => list.data?.offers.filter((candidate) => candidate.offer_id !== offerId) ?? [],
    [list.data, offerId],
  );

  const [outcome, setOutcome] = useState<string | null>(null);
  const [showingOthers, setShowingOthers] = useState(false);

  /*
   * This screen counts as "open" from the moment it mounts, however it was reached — including
   * by replacing another offer screen, which `openOffer()` itself never sees. See the header on
   * `openOffer.ts` for why both the explicit call here AND the one inside `openOffer()` exist.
   */
  useEffect(() => {
    markOfferScreenOpen();
    return () => markOfferScreenClosed();
  }, []);

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
        setTimeout(() => closeOrAdvance(), 1800);
        return;
      }

      /*
       * Won it. Straight to the trip screen — `replace`, not `push`, so the back button cannot
       * return to a ring screen for an offer that is now resolved.
       *
       * The success line still shows for a beat first. Cutting instantly to the next screen makes
       * the tap feel like it did something other than what the driver asked for, and this is the
       * moment they most want confirmation that the trip is actually theirs.
       *
       * Any OTHER live offer is left exactly as it was — winning this one does not touch it. If
       * the driver wants it next, Home's own poll will surface it the moment they get there.
       */
      setOutcome(`Trip ${result.reference} is yours.`);
      setTimeout(() => router.replace(`/trip/${result.booking_id}`), 1200);
    },
    onError: (cause) => {
      setOutcome(cause instanceof Error ? cause.message : 'Could not accept this trip.');
    },
  });

  const decline = useMutation({
    mutationFn: () => declineOffer(offerId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.offers.all() });
      closeOrAdvance();
    },
  });

  /**
   * Leaving this offer — declined, lost the race, or lapsed. If another live offer is already
   * known about, go straight to it rather than back to Home: it was ringing the whole time this
   * one was being decided, and making the driver wait for Home's next poll to be told about a
   * request that has been waiting on them is the exact "proper format" this screen exists for.
   *
   * `router.replace`, not `openOffer()` — this is the screen's own intentional next step, not an
   * external trigger to be deduped against. Its destination's mount effect re-arms
   * `markOfferScreenOpen()` regardless.
   */
  const closeOrAdvance = useCallback(() => {
    const next = others[0];
    if (next !== undefined) {
      router.replace(offerHref(next.offer_id));
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, [others]);

  /**
   * The offer vanished from under us — another driver won, the customer cancelled, or it lapsed.
   * Advancing to the next queued offer (or closing, if none) beats leaving a dead countdown up.
   *
   * GUARDED ON `list.isSuccess`, not merely on `offer === null` — `data` is `undefined` before the
   * first response ever lands, which would otherwise make `offer` look "gone" on the very first
   * render and fire this before the real answer has even arrived.
   *
   * ALSO GUARDED on `acted`. Both mutations above refetch `list` as their first step
   * (`invalidateQueries`), and that refetch naturally resolves with this offer no longer present
   * the instant OUR OWN accept or decline has gone through — it really has vanished, just because
   * we are the one who resolved it. Without this guard that refetch fires THIS effect's
   * `closeOrAdvance()` while the mutation's own `onSuccess`/`onSettled` is still mid-flight, and it
   * navigates again a moment later — two competing navigations off the same screen for one tap.
   */
  const acted = accept.isPending || accept.isSuccess || decline.isPending || decline.isSuccess;

  /**
   * HAS THE SERVER ANSWERED *THIS* SCREEN? — and `isSuccess` was the wrong way to ask.
   *
   * THE BUG THIS FIXES. This query shares `keys.offers.list()` with Home's four-second poll, so
   * the cache almost always holds a previous answer by the time a ring screen mounts. React Query
   * hands that cached answer over on the FIRST render with `status: 'success'` — `staleTime: 0`
   * makes it refetch, not withhold — so `isSuccess` was already true against a list fetched
   * BEFORE this offer existed. The offer was legitimately absent from it, and the effect below
   * closed the screen on the strength of that, typically within a few hundred milliseconds of
   * opening.
   *
   * Observed exactly once on a realme running Android 15 and it looked inexplicable: a live offer
   * the API was returning correctly, the ring screen pushed and then gone 338ms later, after
   * which the per-href latch refused every reopen and the offer became unreachable for the rest
   * of the process. It is not intermittent in nature — it is decided by which caller opens the
   * screen. A push arriving between two polls opens it against a stale cache and it self-closes;
   * Home's own poll opens it against the answer it has just received and everything looks fine,
   * which is why every deliberate test passed.
   *
   * `isFetchedAfterMount` is the honest question: it turns true only when a fetch STARTED BY THIS
   * SCREEN has completed. Before that, this screen knows nothing about whether its offer is live,
   * and must not act as though it does.
   */
  const serverAnswered = list.isFetchedAfterMount;

  useEffect(() => {
    if (serverAnswered && offer === null && outcome === null && !acted) {
      pushLog('ring screen closing: offer not in list', {
        offerId,
        count: list.data?.offers.length ?? -1,
        ids: list.data?.offers.map((o) => o.offer_id) ?? [],
      });
      closeOrAdvance();
    }
  }, [serverAnswered, list.data, offer, outcome, acted, closeOrAdvance, offerId]);

  /**
   * Ring while a live offer is on screen and unanswered.
   *
   * Gated on `outcome === null` as well as the offer existing, so the sound stops the instant
   * the driver acts rather than continuing through the 1.8s the result is shown — a phone still
   * ringing after you have accepted reads as the tap not having registered.
   *
   * CALLED ABOVE THE EARLY RETURNS BELOW, and it must stay there. This is a hook (`useRef` plus
   * `useEffect` inside), so calling it after `if (offer === null) return` made it conditional:
   * accepting or declining resolves the offer, the refetch comes back with `offer: null`, the
   * component takes that early return, and React sees two fewer hooks than the render before —
   * "Rendered fewer hooks than expected", which crashed the screen on every accept. Worse, the
   * throwing render meant this effect's cleanup never ran, so the ring kept playing over the
   * crash. Passing `false` is how the ring is stopped; not calling it at all is a bug.
   */
  useOfferRing(offer !== null && outcome === null);

  /*
   * WAIT, RATHER THAN DECLARE THE TRIP DEAD ON A CACHED ANSWER.
   *
   * `list.isPending` was the gate here, and it is false the moment Home's cached list is handed
   * over — so an offer absent from that older list rendered "This trip is no longer available."
   * over a trip that was ringing perfectly well. Same root cause as the self-close above.
   *
   * ONLY THE ABSENT CASE WAITS. When the cached list DOES contain this offer, it is rendered
   * immediately — the data is right there and the refetch will correct it in a moment. Holding a
   * spinner up in front of a driver for a round-trip we do not need would trade one bug for a
   * slower ring.
   */
  if (offer === null && !serverAnswered) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.brandOnFg} />
      </View>
    );
  }

  if (offer === null) {
    return (
      <View style={styles.loading}>
        <Feather name="slash" size={30} color={colors.onFg} style={styles.goneIcon} />
        <Text style={styles.outcome}>{outcome ?? 'This trip is no longer available.'}</Text>
      </View>
    );
  }

  const busy = accept.isPending || decline.isPending;
  const answered = outcome !== null;

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <View style={styles.serviceBadge}>
          <Feather
            name={offer.service_type === 'INCITY' ? 'map-pin' : 'navigation'}
            size={12}
            color={colors.fg}
          />
          <Text style={styles.serviceBadgeText}>
            {offer.service_type === 'INCITY' ? 'In-city' : 'Outstation'}
          </Text>
        </View>

        <Text style={styles.reference}>{offer.reference}</Text>
      </View>

      <Countdown expiresAt={offer.expires_at} onExpire={closeOrAdvance} paused={answered} />

      {/*
        THE EARNING IS THE DECISION, so it is the largest thing here by a wide margin.

        It is the driver's OWN take — `fareSnapshot.fare.split.driverPaise` server-side, i.e. what
        is left after DriverZone's cut — and the caption says so outright. Drivers reasonably
        assume a headline figure is the fare with a commission still to come out of it; leaving
        that unsaid is how a perfectly fair trip feels worse than it was.
      */}
      <View style={styles.earningBlock}>
        <Text style={styles.earningLabel}>YOU EARN</Text>
        <Text style={styles.earningValue} numberOfLines={1} adjustsFontSizeToFit>
          {offer.earning.amount_display}
        </Text>
        <Text style={styles.earningCaption}>Your share, after commission</Text>
      </View>

      <View style={styles.card}>
        <DetailRow icon="map-pin" label="Pick up" value={offer.pickup.address} pickup lines={3} />
        <View style={styles.divider} />
        <DetailRow icon="flag" label="Drop" value={offer.drop.address} lines={3} />
        <View style={styles.divider} />
        <DetailRow icon="clock" label="When" value={formatWhen(offer.scheduled_at)} />
      </View>

      {/*
        THE BANNER — the point of this whole rewrite. Hidden once answered, same as every other
        transient control here: a driver who has just accepted or declined has nothing left to
        switch to on this screen.
      */}
      {others.length > 0 && !answered ? (
        <Pressable
          onPress={() => setShowingOthers(true)}
          accessibilityRole="button"
          accessibilityLabel={`${String(others.length)} more requests waiting, view them`}
          style={({ pressed }) => [styles.othersBanner, pressed && styles.othersBannerPressed]}
        >
          <Feather name="layers" size={15} color={colors.onFg} />
          <Text style={styles.othersBannerText}>
            +{others.length} more {others.length === 1 ? 'request' : 'requests'} waiting
          </Text>
          <Feather name="chevron-right" size={16} color={colors.onFg} />
        </Pressable>
      ) : null}

      {answered ? (
        <Text style={styles.outcome} accessibilityLiveRegion="assertive">
          {outcome}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          onPress={() => accept.mutate()}
          disabled={busy || answered}
          accessibilityRole="button"
          accessibilityLabel={`Accept trip, you earn ${offer.earning.amount_display}`}
          style={({ pressed }) => [
            styles.accept,
            pressed && styles.pressed,
            (busy || answered) && styles.inert,
          ]}
        >
          {accept.isPending ? (
            <ActivityIndicator color={colors.onFg} />
          ) : (
            <Text style={styles.acceptText}>Accept</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => decline.mutate()}
          disabled={busy || answered}
          accessibilityRole="button"
          accessibilityLabel="Decline trip"
          style={({ pressed }) => [
            styles.decline,
            pressed && styles.pressed,
            (busy || answered) && styles.inert,
          ]}
        >
          {decline.isPending ? (
            <ActivityIndicator color={colors.onFg} />
          ) : (
            <Text style={styles.declineText}>Decline</Text>
          )}
        </Pressable>
      </View>

      <OtherOffersSheet
        visible={showingOthers}
        offers={others}
        onClose={() => setShowingOthers(false)}
        onSelect={(otherId) => {
          setShowingOthers(false);
          // Direct, intentional navigation — not `openOffer()`. See its header and the note on
          // `closeOrAdvance` above.
          router.replace(offerHref(otherId));
        }}
      />
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
  pickup = false,
  lines = 2,
}: {
  icon: 'map-pin' | 'flag' | 'clock';
  label: string;
  value: string;
  /** The pickup gets the on-duty green, so the eye lands on the address first. */
  pickup?: boolean;
  lines?: number;
}): ReactElement {
  return (
    <View style={styles.detailRow}>
      <View style={[styles.detailIcon, pickup && styles.detailIconPickup]}>
        <Feather name={icon} size={15} color={pickup ? colors.dutyOn : colors.muted} />
      </View>
      <View style={styles.detailText}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue} numberOfLines={lines}>
          {value}
        </Text>
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
 *
 * The BAR is the half that works while the driver is doing something else. Its denominator is the
 * time left when this screen FIRST saw the offer, not a hardcoded wave length: on a cold start
 * into a half-spent offer that makes it a bar of the time they actually have, rather than a full
 * bar that lies. The number beside it is the literal truth in either case.
 *
 * `paused` freezes both once the driver has answered — a bar still draining under "Trip is yours"
 * reads as the acceptance not having landed.
 */
function Countdown({
  expiresAt,
  onExpire,
  paused,
}: {
  expiresAt: string;
  onExpire: () => void;
  paused: boolean;
}): ReactElement {
  const expiryMs = useMemo(() => new Date(expiresAt).getTime(), [expiresAt]);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000)),
  );

  // The window as it stood on mount, in a ref so a re-render cannot reset the denominator.
  const initial = useRef(Math.max(1, Math.ceil((expiryMs - Date.now()) / 1000)));

  useEffect(() => {
    if (paused) return;

    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((expiryMs - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) {
        clearInterval(timer);
        onExpire();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [expiryMs, onExpire, paused]);

  const fraction = Math.max(0, Math.min(1, remaining / initial.current));
  /*
   * Under ten seconds both the bar and the number turn red. Colour is the cheapest way to say
   * "now or never" without adding a line of text to a screen that is already asking for a
   * decision — and it is doubled with the shrinking bar rather than carried alone, because this
   * app's population is overwhelmingly male and red/green deficiency runs at ~8%.
   */
  const urgent = remaining <= 10;

  return (
    <View style={styles.countdown}>
      <View style={styles.countdownHeader}>
        <Text style={[styles.countdownValue, urgent && styles.countdownValueUrgent]}>
          {remaining}s
        </Text>
        <Text style={styles.countdownLabel}>to respond</Text>
      </View>

      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: initial.current, now: remaining }}
      >
        <View style={[styles.fill, { width: `${fraction * 100}%` }, urgent && styles.fillUrgent]} />
      </View>
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
  goneIcon: { marginBottom: space.md, opacity: 0.7 },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  serviceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  serviceBadgeText: { ...text.label, color: colors.fg, marginLeft: 5 },
  reference: { ...text.caption, color: colors.onFg, opacity: 0.55 },

  countdown: { marginBottom: space.lg },
  countdownHeader: { flexDirection: 'row', alignItems: 'baseline', marginBottom: space.sm },
  countdownValue: { fontSize: 34, lineHeight: 40, fontWeight: '800', color: colors.brandOnFg },
  countdownValueUrgent: { color: colors.danger },
  countdownLabel: { ...text.body, color: colors.onFg, opacity: 0.6, marginLeft: space.xs },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brandOnFg },
  fillUrgent: { backgroundColor: colors.danger },

  earningBlock: { alignItems: 'center', marginBottom: space.lg },
  earningLabel: {
    ...text.caption,
    color: colors.onFg,
    opacity: 0.6,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  earningValue: {
    fontSize: 60,
    lineHeight: 68,
    fontWeight: '800',
    color: colors.brandOnFg,
    marginTop: 2,
  },
  earningCaption: { ...text.caption, color: colors.onFg, opacity: 0.6, marginTop: 2 },

  card: { backgroundColor: colors.bg, borderRadius: radius.lg, padding: space.md },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start' },
  detailIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  detailIconPickup: { backgroundColor: colors.dutyOnBg },
  detailText: { flex: 1, marginLeft: space.sm },
  detailLabel: {
    ...text.caption,
    color: colors.faint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  detailValue: { ...text.body, color: colors.fg, fontWeight: '600', marginTop: 1 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: space.sm,
  },

  othersBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    marginTop: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  othersBannerPressed: { backgroundColor: 'rgba(255,255,255,0.2)' },
  othersBannerText: { ...text.label, color: colors.onFg },

  outcome: { ...text.body, color: colors.onFg, textAlign: 'center', marginTop: space.md },

  actions: { marginTop: space.lg, gap: space.sm },
  accept: {
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.dutyOn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: { fontSize: 20, fontWeight: '800', color: colors.onFg },
  decline: {
    height: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: { ...text.body, color: colors.onFg, opacity: 0.8 },
  pressed: { opacity: 0.85 },
  inert: { opacity: 0.5 },
});
