import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ensureDutyMachinery } from '@/duty/dutyRecovery';
import { needsLocationDisclosure } from '@/features/onboarding/backgroundLocationDisclosure';
import {
  markNotificationsAccepted,
  markNotificationsDeclined,
} from '@/features/onboarding/notificationDisclosure';
import { registerForPush } from '@/notifications/registerDevice';
import { colors, radius, shadow, space, text } from '@/theme/theme';

/**
 * TRIP ALERTS — shown once, on the first "Go on duty", immediately before Android's notification
 * prompt. See [[notificationDisclosure]] for why it exists when no policy asks for it.
 *
 * FIRST IN A CHAIN OF TWO. Going on duty can need both this and the background-location
 * disclosure; pushed separately they would stack with location on top, so the driver would answer
 * them in reverse. So the duty toggle pushes only this one, and leaving it hands over to the
 * location disclosure when that is still needed — one question at a time, in the order the shift
 * needs them.
 *
 * Swipe-back is disabled in the layout, like the location screen: both buttons record a decision,
 * and a dismissal that recorded nothing would bring the screen back on every duty toggle.
 */
export default function NotificationDisclosureScreen(): ReactElement {
  const [busy, setBusy] = useState(false);

  /** Allow — record it, then let Android ask. `registerForPush` is what shows the prompt. */
  function accept(): void {
    void (async () => {
      setBusy(true);
      try {
        await markNotificationsAccepted();
        await registerForPush(true);
      } finally {
        setBusy(false);
        await next();
      }
    })();
  }

  function decline(): void {
    void markNotificationsDeclined().then(next);
  }

  /** On to the location disclosure if the shift still needs it, otherwise back to duty. */
  async function next(): Promise<void> {
    if (await needsLocationDisclosure()) {
      router.replace('/location-disclosure');
      return;
    }
    // The machinery may have started before notifications were allowed; re-run it so the duty
    // service picks the grant up now rather than at the next resume. A no-op when off duty.
    void ensureDutyMachinery();
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Trip alerts</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.leadIcon}>
          <Feather name="bell" size={26} color={colors.fg} />
        </View>

        <Text style={styles.title}>Allow notifications so trip offers can ring</Text>

        <Text style={styles.lead}>
          When a trip is offered to you, DriverZone rings this phone with a notification — even if
          the screen is off or you are using another app. Android will ask you to allow this next.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardHeading}>What you will get</Text>

          <Bullet icon="phone-incoming">
            Trip offers near you, with the fare and pickup, while you are on duty.
          </Bullet>
          <Bullet icon="navigation">Updates on trips you have accepted, like a cancellation.</Bullet>
          <Bullet icon="bell-off">
            Nothing while you are off duty except updates on your own trips. No advertising.
          </Bullet>
        </View>

        <Text style={styles.hint}>
          If you say no, you can still go on duty, but offers will only reach you while DriverZone
          is open on your screen. You can turn notifications on at any time in your phone&apos;s
          Settings.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton label="Allow" onPress={accept} loading={busy} showArrow={false} />
        <Pressable
          onPress={decline}
          disabled={busy}
          accessibilityRole="button"
          style={styles.declineButton}
        >
          <Text style={styles.declineText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Bullet({
  icon,
  children,
}: {
  icon: keyof typeof Feather.glyphMap;
  children: string;
}): ReactElement {
  return (
    <View style={styles.bullet}>
      <Feather name={icon} size={16} color={colors.muted} style={styles.bulletIcon} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

// The location disclosure's styles, deliberately identical: the two screens are one flow.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  headerTitle: { ...text.heading, color: colors.fg },

  scroll: { padding: space.lg, paddingBottom: space.xl },

  leadIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  title: { ...text.title, color: colors.fg },
  lead: { ...text.body, color: colors.muted, marginTop: space.sm, marginBottom: space.lg },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    ...shadow.soft,
  },
  cardHeading: { ...text.label, color: colors.muted, marginBottom: space.md },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md },
  bulletIcon: { marginRight: space.sm, marginTop: 2 },
  bulletText: { ...text.body, color: colors.fg, flex: 1 },

  hint: { ...text.caption, color: colors.muted, marginTop: space.lg },

  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  declineButton: { alignItems: 'center', paddingVertical: space.md },
  declineText: { ...text.body, color: colors.muted },
});
