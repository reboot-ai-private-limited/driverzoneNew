import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { StatusPill } from '@/components/StatusPill';
import { Logo } from '@/components/Logo';
import {
  canSubmit,
  describeMissing,
  missingLocally,
  screenForMissing,
} from '@/features/onboarding/requirements';
import { ApiError } from '@/lib/api/ApiError';
import { listDocuments, getProfile, submitOnboarding } from '@/lib/api/endpoints/driver';
import * as session from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';
import { colors, radius, shadow, space, text } from '@/theme/theme';

/**
 * The onboarding hub — where an unapproved driver lives until an admin says otherwise.
 *
 * Four statuses, four genuinely different screens' worth of content, one route
 * (docs/LLD/user.md §Driver onboarding & verification):
 *
 *   INCOMPLETE  a checklist of what is still missing, each row tappable
 *   SUBMITTED   a waiting state; nothing to do, and saying so is the honest thing
 *   REJECTED    the admin's reason, verbatim, plus the same checklist and a resubmit
 *   APPROVED    never seen — `/gate` routes those drivers to Home before this mounts
 *
 * Splitting these into separate routes was the first instinct and it is worse: the driver's
 * status changes underneath them while they are looking at it (an admin approves at 11pm), and a
 * single screen that re-renders on a refetch handles that where four routes would need to know
 * how to navigate away from each other.
 */
export default function OnboardingStatusScreen(): ReactElement {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [serverMissing, setServerMissing] = useState<string[] | null>(null);

  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });
  const documents = useQuery({ queryKey: keys.documents.list(), queryFn: listDocuments });

  const submit = useMutation({
    mutationFn: submitOnboarding,
    onMutate: () => {
      setSubmitError(null);
      setServerMissing(null);
    },
    onSuccess: async () => {
      // Refetch rather than write the new status in by hand: the server owns the transition, and
      // a hand-patched cache that disagrees with it is the bug this avoids.
      await queryClient.invalidateQueries({ queryKey: keys.profile.all() });
    },
    onError: (cause) => {
      /**
       * The 400 carries `data.missing` — the exact dot-paths the server's own
       * `missingForSubmission` produced. Rendering those beats rendering our local guess: if the
       * two ever disagree, the server is right, and this is the moment that shows.
       */
      if (cause instanceof ApiError && cause.missingFields.length > 0) {
        setServerMissing(cause.missingFields);
      }
      setSubmitError(cause instanceof Error ? cause.message : 'Could not submit your application.');
    },
  });

  if (profile.isPending || documents.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.fg} />
      </View>
    );
  }

  if (profile.isError || profile.data === undefined) {
    return (
      <View style={styles.loading}>
        <Text style={styles.errorHeading}>Could not load your application</Text>
        <Text style={styles.errorBody}>
          {profile.error instanceof Error ? profile.error.message : 'Please try again.'}
        </Text>
        <Pressable onPress={() => void profile.refetch()} style={styles.retry} accessibilityRole="button">
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const status = profile.data.onboarding_status;
  // The server's list when we have one (it is authoritative), our own optimistic list otherwise
  // so the checklist is populated before the driver has ever tapped Submit.
  const missing = serverMissing ?? missingLocally(profile.data, documents.data);
  const ready = missing.length === 0;

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Logo width={150} />
        <Pressable
          onPress={() => void session.signOut().then(() => router.replace('/phone'))}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Feather name="log-out" size={20} color={colors.fg} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {status === 'SUBMITTED' ? (
          <WaitingCard onRefresh={() => void profile.refetch()} refreshing={profile.isFetching} />
        ) : (
          <>
            {status === 'REJECTED' ? (
              <View style={styles.rejectedCard}>
                <StatusPill label="Not approved" tone="danger" />
                <Text style={styles.rejectedTitle}>Your application needs changes</Text>
                {/*
                  The admin's reason, verbatim. `user.md` requires a reason on every rejection for
                  exactly this — a driver told only "rejected" has nothing to act on and
                  re-uploads the same unreadable photo.
                */}
                <Text style={styles.rejectedReason}>
                  {profile.data.onboarding_rejection_reason ??
                    'An admin asked for changes. Please review your details and documents below.'}
                </Text>
              </View>
            ) : (
              <>
                <Text style={styles.title}>Finish setting up</Text>
                <Text style={styles.subtitle}>
                  We need a few details before an admin can approve you for trips.
                </Text>
              </>
            )}

            <View style={styles.checklist}>
              <Text style={styles.checklistHeading}>
                {ready ? 'Everything is in' : `${missing.length} still needed`}
              </Text>

              <ChecklistRow
                label="Your details"
                done={!missing.some((path) => !path.startsWith('documents.'))}
                onPress={() => router.push('/onboarding-profile')}
              />
              <ChecklistRow
                label="Your documents"
                done={!missing.some((path) => path.startsWith('documents.'))}
                onPress={() => router.push('/onboarding-documents')}
              />
            </View>

            {missing.length > 0 ? (
              <View style={styles.missingBlock}>
                {missing.map((path) => (
                  <Pressable
                    key={path}
                    onPress={() => router.push(screenForMissing(path))}
                    accessibilityRole="button"
                    style={styles.missingRow}
                  >
                    <Feather name="alert-circle" size={15} color={colors.warning} />
                    <Text style={styles.missingText}>{describeMissing(path)}</Text>
                    <Feather name="chevron-right" size={16} color={colors.faint} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {submitError !== null ? (
              <Text style={styles.submitError} accessibilityLiveRegion="polite">
                {submitError}
              </Text>
            ) : null}

            <View style={styles.actions}>
              <PrimaryButton
                label={status === 'REJECTED' ? 'Resubmit application' : 'Submit for approval'}
                onPress={() => submit.mutate()}
                loading={submit.isPending}
                // `canSubmit` mirrors the server: SUBMITTED cannot resubmit, because doing so
                // would reset the driver's place in the review queue.
                disabled={!ready || !canSubmit(status)}
              />
            </View>
          </>
        )}
      </View>
    </ScrollView>
  );
}

/**
 * The SUBMITTED state.
 *
 * There is no Submit button here, and that is the server's rule rather than a layout choice:
 * `canSubmit` allows only `INCOMPLETE` and `REJECTED`, because resubmitting from the queue would
 * reset the driver's place in it. A driver who tapped twice would quietly go to the back.
 *
 * **But editing is still allowed, and this card must say so.** Nothing on the server gates
 * `PATCH /driver/profile` or `POST /driver/documents` on onboarding status — re-uploading a
 * document upserts the row back to `PENDING`, in place, and the reviewer simply sees the newer
 * photo. Hiding the links (which this screen did) left a driver who noticed their own licence was
 * blurry with no way to fix it and no way to resubmit: locked out until an admin rejected them,
 * for a problem they could have corrected in ten seconds.
 *
 * A progress bar or an ETA would be inventing information — review is a human opening the admin
 * panel, and we do not know when. Refresh is the one honest status control: approval happens
 * server-side and this app has no socket yet to hear about it.
 */
function WaitingCard({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}): ReactElement {
  return (
    <>
      <View style={styles.waitingCard}>
        <View style={styles.waitingIcon}>
          <Feather name="clock" size={28} color={colors.warning} />
        </View>
        <Text style={styles.waitingTitle}>Application under review</Text>
        <Text style={styles.waitingBody}>
          Our team is checking your details and documents. You will be able to go on duty as soon
          as you are approved.
        </Text>

        <Pressable
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          style={styles.refreshButton}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.fg} />
          ) : (
            <>
              <Feather name="refresh-cw" size={15} color={colors.fg} />
              <Text style={styles.refreshText}>Check for an update</Text>
            </>
          )}
        </Pressable>
      </View>

      <View style={styles.stillEditable}>
        <Text style={styles.stillEditableHeading}>Need to change something?</Text>
        {/*
          Says explicitly that no resubmit is needed. Without this line the driver updates a photo,
          looks for a Submit button, cannot find one, and reasonably concludes the change did not
          take — which is how the same document gets uploaded four times.
        */}
        <Text style={styles.stillEditableBody}>
          You can still update your details or replace a photo. Your place in the queue is kept —
          the reviewer sees whatever is latest, so there is nothing to submit again.
        </Text>

        <Pressable
          onPress={() => router.push('/onboarding-profile')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.editRow, pressed && styles.editRowPressed]}
        >
          <Feather name="user" size={17} color={colors.fg} style={styles.editIcon} />
          <Text style={styles.editLabel}>Your details</Text>
          <Feather name="chevron-right" size={17} color={colors.faint} />
        </Pressable>

        <Pressable
          onPress={() => router.push('/onboarding-documents')}
          accessibilityRole="button"
          style={({ pressed }) => [styles.editRow, pressed && styles.editRowPressed]}
        >
          <Feather name="file-text" size={17} color={colors.fg} style={styles.editIcon} />
          <Text style={styles.editLabel}>Your documents</Text>
          <Feather name="chevron-right" size={17} color={colors.faint} />
        </Pressable>
      </View>
    </>
  );
}

function ChecklistRow({
  label,
  done,
  onPress,
}: {
  label: string;
  done: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ checked: done }}
      style={({ pressed }) => [styles.checkRow, pressed && styles.checkRowPressed]}
    >
      <View style={[styles.checkDot, done && styles.checkDotDone]}>
        <Feather name={done ? 'check' : 'more-horizontal'} size={14} color={done ? colors.onFg : colors.muted} />
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
      <StatusPill label={done ? 'Complete' : 'Incomplete'} tone={done ? 'success' : 'pending'} />
      <Feather name="chevron-right" size={18} color={colors.faint} style={styles.checkChevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  errorHeading: { ...text.heading, color: colors.fg, textAlign: 'center' },
  errorBody: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.sm },
  retry: {
    marginTop: space.lg,
    backgroundColor: colors.fg,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    borderRadius: radius.pill,
  },
  retryText: { ...text.label, color: colors.brandOnFg },

  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  body: { padding: space.lg },

  title: { ...text.title, color: colors.fg },
  subtitle: { ...text.body, color: colors.muted, marginTop: space.sm, marginBottom: space.lg },

  rejectedCard: {
    backgroundColor: '#FDEDEE',
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.lg,
  },
  rejectedTitle: { ...text.heading, color: colors.fg, marginTop: space.sm },
  rejectedReason: { ...text.body, color: colors.fg, marginTop: space.xs },

  checklist: { marginBottom: space.md },
  checklistHeading: { ...text.label, color: colors.muted, marginBottom: space.sm },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  checkRowPressed: { backgroundColor: colors.bgSunken },
  checkDot: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  checkDotDone: { backgroundColor: colors.success },
  checkLabel: { ...text.body, color: colors.fg, flex: 1 },
  checkChevron: { marginLeft: space.xs },

  missingBlock: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    marginBottom: space.lg,
  },
  missingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  missingText: { ...text.body, color: colors.fg, flex: 1, marginLeft: space.sm },

  submitError: { ...text.caption, color: colors.danger, marginBottom: space.sm },
  actions: { marginTop: space.sm },

  waitingCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    ...shadow.card,
  },
  waitingIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: '#FFF6E0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  waitingTitle: { ...text.heading, color: colors.fg, textAlign: 'center' },
  waitingBody: {
    ...text.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.sm,
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 200,
  },
  refreshText: { ...text.label, color: colors.fg, marginLeft: space.sm },

  stillEditable: { marginTop: space.xl },
  stillEditableHeading: { ...text.label, color: colors.muted, marginBottom: space.xs },
  stillEditableBody: { ...text.caption, color: colors.muted, marginBottom: space.md },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  editRowPressed: { backgroundColor: colors.bgSunken },
  editIcon: { marginRight: space.md },
  editLabel: { ...text.body, color: colors.fg, flex: 1 },
});
