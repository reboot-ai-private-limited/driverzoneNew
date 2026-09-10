import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentProps, type ReactElement, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PrimaryButton } from '@/components/PrimaryButton';
import { getBooking, rateTrip } from '@/lib/api/endpoints/bookings';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * Rate your driver — shown once, right after a trip completes (`app/trip/[id].tsx`'s own
 * COMPLETED-transition effect routes here; nothing else links to this page).
 *
 * REAL, all the way through. `POST /customer/bookings/:id/rate` exists, works, and enforces its
 * own rules server-side — COMPLETED only, one rating per reviewer, a submission window — so this
 * screen does not duplicate any of that logic, it just reports whatever the server refuses with.
 *
 * NO DRIVER PHOTO, RATING AVERAGE, TRIP COUNT OR VEHICLE LIST. `BookingDto.driver` is `{ id, name
 * } | null` — the same limit `app/trip/[id].tsx` already documents — so the driver card here
 * shows a name and nothing invented to go with it. No Call button either, for the same reason:
 * no phone number is ever exposed to a customer's device.
 */
interface Tag {
  value: string;
  label: string;
  icon: FeatherName;
}

/**
 * THE CHIPS DEPEND ON THE STARS, and that is the whole point of this table.
 *
 * One fixed list served every rating before, which meant a customer giving one star was offered
 * "Excellent" and "Friendly" — chips that cannot describe the trip they just had — while the
 * words for what actually went wrong were missing. Worse, the value crossing the wire is the
 * chip's own text, so those mismatched labels landed in ops' review queue as the reasons for a
 * one-star trip.
 *
 * FOUR PER RATING, deliberately. The set has to be readable in one glance on a screen the
 * customer is trying to leave; a longer list gets scrolled past rather than answered.
 *
 * Labels REPEAT ACROSS SETS on purpose — "Safe Driving" is offered at four and five stars, "Very
 * Late" at one and two. They are the same fact reported at different severities, so keeping one
 * spelling means ops can count a tag across ratings without normalising anything first.
 *
 * NOT A CONTRACT. `POST /:id/rate` takes `tags: string[]` and validates nothing about their
 * content (`RateTripInput`), so this list can change without a server release — and an older
 * build's tags stay valid after it does.
 */
const TAGS_BY_RATING: Readonly<Record<number, readonly Tag[]>> = {
  5: [
    { value: 'Excellent Service', label: 'Excellent Service', icon: 'thumbs-up' },
    { value: 'Safe Driving', label: 'Safe Driving', icon: 'shield' },
    { value: 'Professional', label: 'Professional', icon: 'briefcase' },
    { value: 'Well Dressed', label: 'Well Dressed', icon: 'user-check' },
  ],
  4: [
    { value: 'Good Service', label: 'Good Service', icon: 'thumbs-up' },
    { value: 'Safe Driving', label: 'Safe Driving', icon: 'shield' },
    { value: 'Slightly Late', label: 'Slightly Late', icon: 'clock' },
    { value: 'Could Improve', label: 'Could Improve', icon: 'trending-up' },
  ],
  3: [
    { value: 'Late Arrival', label: 'Late Arrival', icon: 'clock' },
    { value: 'Average Service', label: 'Average Service', icon: 'meh' },
    { value: 'Not Professional', label: 'Not Professional', icon: 'briefcase' },
    { value: 'Poor Communication', label: 'Poor Communication', icon: 'message-circle' },
  ],
  2: [
    { value: 'Very Late', label: 'Very Late', icon: 'clock' },
    { value: 'Rash Driving', label: 'Rash Driving', icon: 'alert-triangle' },
    { value: 'Poor Behaviour', label: 'Poor Behaviour', icon: 'frown' },
    { value: 'Untidy Appearance', label: 'Untidy Appearance', icon: 'user-x' },
  ],
  1: [
    { value: 'Rash Driving', label: 'Rash Driving', icon: 'alert-triangle' },
    { value: 'Misbehaviour', label: 'Misbehaviour', icon: 'frown' },
    { value: 'Very Late', label: 'Very Late', icon: 'clock' },
    { value: 'Unprofessional', label: 'Unprofessional', icon: 'briefcase' },
  ],
};

/** Four and five stars are praise; three and below are a complaint. Decides wording and colour. */
const POSITIVE_AT_OR_ABOVE = 4;

/**
 * The chip block's own heading, which cannot be one sentence any more.
 *
 * "What did you like about your trip?" over a two-star set reads as sarcasm, so the question
 * follows the stars exactly as the chips do.
 */
const TAG_PROMPTS: Record<number, { title: string; hint: string }> = {
  5: { title: 'What went well?', hint: 'Select all that apply' },
  4: { title: 'What went well?', hint: 'Select all that apply' },
  3: { title: 'What could have been better?', hint: 'Select all that apply' },
  2: { title: 'What went wrong?', hint: 'Select all that apply' },
  1: { title: 'What went wrong?', hint: 'Select all that apply' },
};

const RATING_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Fair',
  3: 'Good',
  4: 'Very Good',
  5: 'Excellent',
};

const COMMENT_MAX = 500;

export default function RateDriverScreen(): ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>();

  const booking = useQuery({
    queryKey: keys.bookings.detail(id),
    queryFn: () => getBooking(id),
  });

  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');

  const submit = useMutation({
    mutationFn: () =>
      rateTrip(id, {
        rating,
        tags,
        ...(comment.trim().length === 0 ? {} : { comment: comment.trim() }),
      }),
    onSuccess: () => router.replace('/home'),
  });

  function toggleTag(value: string): void {
    setTags((current) =>
      current.includes(value) ? current.filter((tag) => tag !== value) : [...current, value],
    );
  }

  /**
   * Re-rating DROPS the tags the new star count does not offer, and keeps the ones it does.
   *
   * Without this, a customer who ticks "Excellent Service" at five stars and then drops to one
   * submits a one-star review tagged "Excellent Service" — a chip that is no longer on the screen
   * they are looking at, and that they have no way to untick. Since the sets share labels, the
   * filter also does the right thing in the ordinary case: moving five stars to four keeps "Safe
   * Driving" ticked, because four stars offers it too.
   */
  function chooseRating(value: number): void {
    setRating(value);
    const offered = TAGS_BY_RATING[value] ?? [];
    setTags((current) => current.filter((tag) => offered.some((option) => option.value === tag)));
  }

  const positive = rating >= POSITIVE_AT_OR_ABOVE;
  const tagOptions = TAGS_BY_RATING[rating] ?? [];
  const prompt = TAG_PROMPTS[rating];

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.replace('/home')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip and go home"
          style={styles.headerSide}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Rate Your Driver</Text>
          <Text style={styles.headerSubtitle}>Your feedback helps us improve</Text>
        </View>
        <Pressable
          onPress={() => router.push('/info/help')}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Help & Support"
          style={styles.headerSide}
        >
          <Feather name="headphones" size={20} color={colors.fg} />
        </Pressable>
      </View>

      {booking.isPending ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {booking.data?.driver === null || booking.data === undefined ? null : (
            <View style={styles.card}>
              <View style={styles.driverRow}>
                <View style={styles.avatar}>
                  <Feather name="user" size={24} color={colors.fg} />
                </View>
                <Text style={styles.driverName} numberOfLines={1}>
                  {booking.data.driver.name ?? 'Your driver'}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>How was your experience?</Text>
            <Text style={styles.cardHint}>Tap a star to rate your driver</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => chooseRating(value)}
                  hitSlop={6}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: rating === value }}
                  accessibilityLabel={`${String(value)} star${value === 1 ? '' : 's'}`}
                >
                  <Feather
                    name="star"
                    size={34}
                    color={value <= rating ? colors.brand : colors.border}
                  />
                </Pressable>
              ))}
            </View>

            {rating === 0 ? null : (
              <Animated.Text
                entering={FadeIn.duration(150)}
                style={[styles.ratingLabel, !positive && styles.ratingLabelCritical]}
              >
                {RATING_LABELS[rating]}
              </Animated.Text>
            )}
          </View>

          {/*
            NO CHIPS BEFORE A STAR, because there is no set to show. Which four appear is decided
            by the rating, so offering any of them first would mean showing one rating's words to
            a customer who has not said which rating they mean — and then swapping them under the
            finger that was about to tap.
          */}
          {rating === 0 || prompt === undefined ? null : (
            <Animated.View entering={FadeIn.duration(180)} style={styles.card}>
              <Text style={styles.cardTitle}>{prompt.title}</Text>
              <Text style={styles.cardHint}>{prompt.hint}</Text>

              <View style={styles.tagsGrid}>
                {tagOptions.map((tag) => {
                  const active = tags.includes(tag.value);
                  /*
                    A TICKED CHIP TAKES THE TONE OF THE RATING, not one fixed green. "Rash
                    Driving" highlighted in the same success green as "Safe Driving" reads as
                    approval of the thing being reported.
                  */
                  const activeTint = positive ? colors.success : colors.danger;
                  return (
                    <Pressable
                      key={tag.value}
                      onPress={() => toggleTag(tag.value)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                      style={[
                        styles.tagChip,
                        active && (positive ? styles.tagChipActive : styles.tagChipActiveCritical),
                      ]}
                    >
                      <Feather
                        name={tag.icon}
                        size={14}
                        color={active ? activeTint : colors.muted}
                      />
                      <Text style={[styles.tagLabel, active && { color: activeTint }]}>
                        {tag.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Animated.View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              Additional Comments <Text style={styles.optional}>(Optional)</Text>
            </Text>
            <Text style={styles.cardHint}>Tell us more about your experience</Text>

            <TextInput
              value={comment}
              onChangeText={(value) => setComment(value.slice(0, COMMENT_MAX))}
              placeholder="Write your comments here..."
              placeholderTextColor={colors.faint}
              multiline
              style={styles.commentInput}
              accessibilityLabel="Additional comments"
            />
            <Text style={styles.commentCount}>
              {comment.length} / {COMMENT_MAX}
            </Text>

            <View style={styles.privacyNote}>
              <Feather name="shield" size={14} color={colors.fg} style={styles.privacyIcon} />
              <Text style={styles.privacyText}>
                Your feedback is private and helps us ensure better service for you.
              </Text>
            </View>
          </View>

          {submit.isError ? (
            <Text style={styles.submitError}>
              {submit.error instanceof Error
                ? submit.error.message
                : 'Could not submit your rating.'}
            </Text>
          ) : null}

          <PrimaryButton
            label="Submit Rating"
            onPress={() => submit.mutate()}
            loading={submit.isPending}
            disabled={rating === 0}
            showArrow={false}
          />

          <Pressable
            onPress={() => router.replace('/home')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.skipButton, pressed && styles.skipButtonPressed]}
          >
            <Text style={styles.skipLabel}>Skip</Text>
          </Pressable>

          <View style={styles.lockRow}>
            <Feather name="lock" size={12} color={colors.faint} />
            <Text style={styles.lockText}>Your feedback is safe and secure with us.</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  headerSide: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, alignItems: 'center' },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSubtitle: { ...text.caption, color: colors.fg, opacity: 0.7, marginTop: 1 },

  content: { padding: space.lg, paddingBottom: space.xl },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.md,
  },
  cardTitle: { ...text.heading, fontSize: 16, color: colors.fg },
  cardHint: { ...text.caption, color: colors.muted, marginTop: 2, marginBottom: space.md },
  optional: { color: colors.faint, fontFamily: fontFamily.regular },

  driverRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  driverName: { ...text.body, color: colors.fg, fontFamily: fontFamily.bold, flex: 1 },

  starsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.sm },
  ratingLabel: {
    ...text.label,
    color: colors.success,
    fontFamily: fontFamily.bold,
    textAlign: 'center',
    marginTop: space.md,
  },
  /** "Poor" and "Fair" set in success green read as the app disagreeing with the customer. */
  ratingLabelCritical: { color: colors.danger },

  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tagChipActive: { borderColor: colors.success, backgroundColor: '#E7F5EC' },
  /** The same chip at one to three stars — see the tone note where it is applied. */
  tagChipActiveCritical: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  tagLabel: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },

  commentInput: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
    padding: space.md,
    color: colors.fg,
    textAlignVertical: 'top',
    ...text.body,
  },
  commentCount: { ...text.caption, color: colors.faint, textAlign: 'right', marginTop: space.xs },

  privacyNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.md,
  },
  privacyIcon: { marginRight: space.sm, marginTop: 1 },
  privacyText: { ...text.caption, color: colors.fg, flex: 1 },

  submitError: {
    ...text.caption,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: space.sm,
  },

  skipButton: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  skipButtonPressed: { backgroundColor: colors.bgSunken },
  skipLabel: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },

  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: space.md,
  },
  lockText: { ...text.caption, color: colors.faint },
});
