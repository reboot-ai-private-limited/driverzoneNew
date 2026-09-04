import { Feather } from '@expo/vector-icons';
import { useMutation } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { type ComponentProps, type ReactElement, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';
import { PrimaryButton } from '@/components/PrimaryButton';
import { rateCustomer } from '@/lib/api/endpoints/trip';
import { colors, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * RATING THE CUSTOMER — the other half of a two-sided review system.
 *
 * The customer app has rated drivers since it shipped; this side never existed, so every review
 * was one-directional. That is not only a missing feature: publishing is DOUBLE-BLIND, and the
 * second review is what closes the blind window early. With no driver-side rating, a customer's
 * review of their driver sat unpublished until `reviews.submission_window_hours` elapsed, every
 * single time.
 *
 * **Inline on the completion panel, not a route of its own.** The customer app replaces its trip
 * screen with `/rate/[id]` because a passenger has nothing else to do when they get out. A driver
 * does: they are trying to get back on duty for the next fare. Putting this in their way as a
 * screen they must dismiss is how it gets dismissed unread — so it sits under the completion
 * summary, and "Back to duty" remains right there whether they rate or not.
 *
 * **Skippable, deliberately.** A rating nobody chose to give is noise in the data, and the server
 * already handles the unrated case by releasing the other side's review when the window closes.
 */

/**
 * Tags for rating a CUSTOMER, which are not the customer app's list inverted.
 *
 * DriverZone sends a driver to the customer's OWN car (docs/LLD/open-questions.md Q5), so the
 * things that make a job good or bad here are different in kind from a passenger's: whether the
 * person was ready, how they behaved, and the state of the car the driver had to work in — that
 * last one has no counterpart at all on the customer's side.
 *
 * Free strings on the wire; the server stores them verbatim and the admin panel renders them as
 * badges. Positive first, so the list does not read as an invitation to complain.
 */
const TAGS: ReadonlyArray<{ value: string; label: string; icon: FeatherName }> = [
  { value: 'Polite', label: 'Polite', icon: 'smile' },
  { value: 'Ready On Time', label: 'Ready on time', icon: 'check-circle' },
  { value: 'Car Well Maintained', label: 'Car well kept', icon: 'shield' },
  { value: 'Kept Me Waiting', label: 'Kept me waiting', icon: 'clock' },
  { value: 'Rude Behaviour', label: 'Rude behaviour', icon: 'frown' },
  { value: 'Wrong Pickup Point', label: 'Wrong pickup point', icon: 'map-pin' },
];

/** What each score means, so a driver is not guessing whether 3 is good. */
const RATING_LABELS: Record<number, string> = {
  1: 'Very poor',
  2: 'Poor',
  3: 'Okay',
  4: 'Good',
  5: 'Excellent',
};

const COMMENT_MAX = 500;

interface RateCustomerProps {
  bookingId: string;
  /** Shown in the prompt so the driver knows who they are rating. */
  customerName?: string | null;
  /** Called once the rating lands, so the parent can collapse this away. */
  onRated?: () => void;
}

export function RateCustomer({
  bookingId,
  customerName,
  onRated,
}: RateCustomerProps): ReactElement {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () =>
      rateCustomer(bookingId, {
        rating,
        tags,
        // Omitted rather than sent empty: an absent comment and a blank one are different facts,
        // and the server's schema treats the field as optional.
        ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
      }),
    onMutate: () => setError(null),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onRated?.();
    },
    onError: (cause) => {
      /*
       * The server's own wording, verbatim. Every refusal here is a real rule a driver can act
       * on — already rated, window closed, trip not complete — and paraphrasing them into "could
       * not submit" would hide which one it was.
       */
      setError(cause instanceof Error ? cause.message : 'Could not submit your rating.');
    },
  });

  if (submit.isSuccess) {
    return (
      <Animated.View entering={FadeIn} style={styles.done}>
        <Feather name="check-circle" size={18} color={colors.dutyOn} />
        <Text style={styles.doneText}>Thanks — your rating has been recorded.</Text>
      </Animated.View>
    );
  }

  return (
    <Animated.View layout={LinearTransition.springify().damping(18)} style={styles.root}>
      <Text style={styles.title}>
        {customerName == null || customerName === ''
          ? 'Rate your customer'
          : `How was ${customerName}?`}
      </Text>
      <Text style={styles.body}>Only shared once you have both rated.</Text>

      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((star) => {
          const on = star <= rating;
          return (
            <Pressable
              key={star}
              onPress={() => {
                void Haptics.selectionAsync();
                setRating(star);
              }}
              hitSlop={6}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
              style={styles.star}
            >
              <Feather
                name="star"
                size={34}
                color={on ? colors.focus : colors.border}
                // `star` has no filled variant in Feather, so the fill is what separates a chosen
                // star from an empty one — colour alone at this size is too subtle to read.
                style={on ? styles.starOn : undefined}
              />
            </Pressable>
          );
        })}
      </View>

      {rating > 0 ? (
        <Animated.Text entering={FadeIn.duration(180)} style={styles.ratingLabel}>
          {RATING_LABELS[rating]}
        </Animated.Text>
      ) : null}

      {/* Tags and the comment box appear only once a rating exists — before that there is nothing
          for them to qualify, and showing them up front makes a one-tap job look like a form. */}
      {rating > 0 ? (
        <Animated.View entering={FadeInDown.duration(220)}>
          <View style={styles.tagsGrid}>
            {TAGS.map((tag) => {
              const active = tags.includes(tag.value);
              return (
                <Pressable
                  key={tag.value}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setTags((current) =>
                      active ? current.filter((t) => t !== tag.value) : [...current, tag.value],
                    );
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: active }}
                  style={[styles.tag, active && styles.tagOn]}
                >
                  <Feather
                    name={tag.icon}
                    size={13}
                    color={active ? colors.brandOnFg : colors.muted}
                  />
                  <Text style={[styles.tagLabel, active && styles.tagLabelOn]}>{tag.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={comment}
            onChangeText={(value) => setComment(value.slice(0, COMMENT_MAX))}
            placeholder="Anything else? (optional)"
            placeholderTextColor={colors.faint}
            multiline
            style={styles.comment}
            accessibilityLabel="Comment about this customer"
          />

          {error !== null ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <View style={styles.submit}>
            <PrimaryButton
              label="Submit rating"
              onPress={() => submit.mutate()}
              loading={submit.isPending}
              showArrow={false}
            />
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.lg,
  },
  title: { ...text.heading, color: colors.fg, textAlign: 'center' },
  body: { ...text.caption, color: colors.muted, textAlign: 'center', marginTop: 2 },

  stars: { flexDirection: 'row', justifyContent: 'center', marginTop: space.md },
  star: { paddingHorizontal: space.xs },
  starOn: { textShadowColor: colors.focus, textShadowRadius: 1 },
  ratingLabel: {
    ...text.label,
    color: colors.fg,
    textAlign: 'center',
    marginTop: space.xs,
  },

  tagsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    justifyContent: 'center',
    marginTop: space.md,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs + 2,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  tagOn: { backgroundColor: colors.fg, borderColor: colors.fg },
  tagLabel: { ...text.caption, color: colors.muted },
  tagLabelOn: { color: colors.brandOnFg, fontWeight: '600' },

  comment: {
    ...text.body,
    color: colors.fg,
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.sm,
    marginTop: space.md,
    minHeight: 72,
    textAlignVertical: 'top',
  },

  error: { ...text.caption, color: colors.danger, marginTop: space.sm },
  submit: { marginTop: space.md },

  done: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.dutyOnBg,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.lg,
  },
  doneText: { ...text.body, color: colors.fg, marginLeft: space.sm },
});
