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
const TAGS: ReadonlyArray<{ value: string; label: string; icon: FeatherName }> = [
  { value: 'Excellent', label: 'Excellent', icon: 'thumbs-up' },
  { value: 'Professional', label: 'Professional', icon: 'briefcase' },
  { value: 'Safe Driving', label: 'Safe Driving', icon: 'shield' },
  { value: 'Friendly', label: 'Friendly', icon: 'smile' },
  { value: 'Late Arrival', label: 'Late Arrival', icon: 'clock' },
  { value: 'Poor Behaviour', label: 'Poor Behaviour', icon: 'frown' },
];

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
                  onPress={() => setRating(value)}
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
              <Animated.Text entering={FadeIn.duration(150)} style={styles.ratingLabel}>
                {RATING_LABELS[rating]}
              </Animated.Text>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>What did you like about your trip?</Text>
            <Text style={styles.cardHint}>Select all that apply</Text>

            <View style={styles.tagsGrid}>
              {TAGS.map((tag) => {
                const active = tags.includes(tag.value);
                return (
                  <Pressable
                    key={tag.value}
                    onPress={() => toggleTag(tag.value)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    style={[styles.tagChip, active && styles.tagChipActive]}
                  >
                    <Feather
                      name={tag.icon}
                      size={14}
                      color={active ? colors.success : colors.muted}
                    />
                    <Text style={[styles.tagLabel, active && styles.tagLabelActive]}>
                      {tag.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

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
  tagLabel: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },
  tagLabelActive: { color: colors.success },

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
