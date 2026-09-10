import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { FaqDto } from '@driverzone/contracts';
import { useFaqs } from '@/features/faq/useFaqs';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * FAQs — written by an admin, read here and in the CUSTOMER app from the same list.
 *
 * Deliberately mirrors `apps/customer/app/info/faqs.tsx`, in the same way `info/[topic].tsx`
 * mirrors its twin. It is more than a convention here: the customer is reading these exact
 * answers, and a driver quoting a different figure at them is the argument the FAQs exist to
 * settle. If one screen is changed, change the other.
 *
 * A REAL SCREEN, unlike its neighbours in `info/[topic].tsx`, which is why it is a file of its
 * own rather than another topic in that switch. Those are placeholders with hardcoded prose and a
 * notice saying so; this has an endpoint behind it and the states that come with one.
 *
 * IT IS WHERE THE CASH CHARGES ARE WRITTEN DOWN — what a customer owes for food and a place to
 * stay on a long trip, which the app quotes nowhere and neither side settles through it. That is
 * why `faqCache` keeps an offline copy: the conversation this answers happens at the roadside.
 */
export default function FaqsScreen(): ReactElement {
  const { faqs, fromCache, cachedAt, loading, error, refetch } = useFaqs();

  /**
   * One open at a time. An accordion that lets every panel open at once turns a list somebody is
   * scanning into a wall of prose, and the question they were reading scrolls off the top.
   */
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.back}
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          FAQs
        </Text>
        <View style={styles.back} />
      </View>

      {loading && faqs.length === 0 ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.muted} />
        </View>
      ) : error !== null ? (
        /*
          Reached only when there is NOTHING to show — no live answer and no copy on disk. A
          failure with a cached copy is not an error state; see `useFaqs`.
        */
        <View style={styles.centre}>
          <Feather name="wifi-off" size={28} color={colors.faint} />
          <Text style={styles.errorTitle}>Could not load the FAQs</Text>
          <Text style={styles.errorBody}>{error.message}</Text>
          <Pressable
            onPress={refetch}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : faqs.length === 0 ? (
        <View style={styles.centre}>
          <Feather name="book-open" size={28} color={colors.faint} />
          <Text style={styles.errorTitle}>Nothing here yet</Text>
          <Text style={styles.errorBody}>
            Answers appear here as we publish them. In the meantime, Help &amp; Support reaches a
            person.
          </Text>
          <Pressable
            onPress={() => router.push('/info/help')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
          >
            <Text style={styles.retryLabel}>Help &amp; Support</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/*
            SAYS SO WHEN IT IS OLD, rather than passing a stored answer off as the current one.
            These entries carry amounts of money; a customer quoting a figure at a driver deserves
            to know it came off their own phone and not from us just now.
          */}
          {fromCache ? (
            <View style={styles.staleNote}>
              <Feather name="wifi-off" size={13} color={colors.muted} style={styles.staleIcon} />
              <Text style={styles.staleText}>
                {loading ? 'Checking for updates — ' : ''}
                showing the copy saved on this phone
                {cachedAt === null ? '' : ` on ${formatSavedAt(cachedAt)}`}.
              </Text>
            </View>
          ) : null}

          {faqs.map((faq) => (
            <FaqRow
              key={faq.id}
              faq={faq}
              open={openId === faq.id}
              onToggle={() => setOpenId((current) => (current === faq.id ? null : faq.id))}
            />
          ))}

          <Text style={styles.footer}>
            Still stuck? Help &amp; Support reaches a person, not an automated reply.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

/** Date only. The hour a help article was cached is noise; the day is the part worth knowing. */
function formatSavedAt(date: Date): string {
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function FaqRow({
  faq,
  open,
  onToggle,
}: {
  faq: FaqDto;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <Animated.View layout={LinearTransition.duration(180)} style={styles.card}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        // Announced as its state, not as an instruction: "expanded"/"collapsed" is what a screen
        // reader user needs, and `accessibilityState` is what carries it.
        accessibilityState={{ expanded: open }}
        accessibilityLabel={faq.question}
        style={({ pressed }) => [styles.question, pressed && styles.questionPressed]}
      >
        <Text style={styles.questionText}>{faq.question}</Text>
        <Feather
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.muted}
          style={styles.chevron}
        />
      </Pressable>

      {open ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
          <Text style={styles.answer}>{faq.answer}</Text>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },

  /** Matching `info/[topic].tsx`'s header exactly, so the two screens sit flush in one stack. */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { width: 32, height: 32, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { ...text.heading, color: colors.fg, flex: 1, textAlign: 'center' },

  content: { padding: space.lg, paddingBottom: space.xl },

  staleNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.md,
  },
  staleIcon: { marginRight: space.sm, marginTop: 1 },
  staleText: { ...text.caption, color: colors.muted, flex: 1 },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    marginBottom: space.sm,
    overflow: 'hidden',
  },
  question: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 52,
  },
  questionPressed: { backgroundColor: colors.bgSunken },
  questionText: { ...text.label, color: colors.fg, flex: 1, fontFamily: fontFamily.semibold },
  chevron: { marginLeft: space.sm },
  answer: {
    ...text.body,
    color: colors.muted,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
  },

  errorTitle: {
    ...text.label,
    color: colors.fg,
    fontFamily: fontFamily.bold,
    marginTop: space.md,
    textAlign: 'center',
  },
  errorBody: {
    ...text.caption,
    color: colors.muted,
    marginTop: space.xs,
    textAlign: 'center',
  },
  retry: {
    marginTop: space.md,
    paddingHorizontal: space.lg,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryPressed: { backgroundColor: colors.bgSunken },
  retryLabel: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },

  footer: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.md },
});
