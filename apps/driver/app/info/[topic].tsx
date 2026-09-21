import { Feather } from '@expo/vector-icons';
import notifee from '@notifee/react-native';
import Constants from 'expo-constants';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DUTY_ALERT_CHANNEL_ID, OFFER_CHANNEL_ID } from '@/notifications/channel';
import { colors, space, text } from '@/theme/theme';

/**
 * One route standing in for the Account-tab rows that have nothing behind them yet:
 * Notifications, Help & Support, Privacy Policy, Terms & Conditions, About DriverZone. None has
 * an API surface today — no CMS-backed legal or help content — so a single generic screen beats
 * five near-identical files.
 *
 * NOTIFICATIONS IS NO LONGER ONE OF THE PLACEHOLDERS. It does not need an API surface: the
 * settings it offers belong to Android, and it hands the driver straight to them. See
 * `NotificationsBody`.
 *
 * Mirrors `apps/customer/app/info/[topic].tsx` — the two apps should read the same. The
 * notifications topic is the one place they have diverged: that app still shows the placeholder
 * switches, and its real channel (`booking-updates-v1`) has not been given this treatment yet.
 */
const TOPICS = ['notifications', 'help', 'privacy', 'terms', 'about'] as const;
type Topic = (typeof TOPICS)[number];

const TITLES: Record<Topic, string> = {
  notifications: 'Notifications',
  help: 'Help & Support',
  privacy: 'Privacy Policy',
  terms: 'Terms & Conditions',
  about: 'About DriverZone',
};

export default function InfoScreen(): ReactElement {
  const { topic: raw } = useLocalSearchParams<{ topic: string }>();
  const topic = (TOPICS as readonly string[]).includes(raw) ? (raw as Topic) : null;

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
          {topic === null ? 'Not found' : TITLES[topic]}
        </Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {topic === null ? (
          <Text style={styles.body}>Nothing here.</Text>
        ) : topic === 'notifications' ? (
          <NotificationsBody />
        ) : topic === 'help' ? (
          <HelpBody />
        ) : (
          <StaticBody topic={topic} />
        )}
      </ScrollView>
    </View>
  );
}

function DemoNotice({ children }: { children: ReactNode }): ReactElement {
  return (
    <View style={styles.notice}>
      <Feather name="info" size={13} color={colors.muted} />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

/**
 * THE ROWS ARE THE APP'S REAL NOTIFICATION CHANNELS, and each one opens Android's own settings
 * page for it.
 *
 * `channelId` must match `notifications/channel.ts` exactly — Android looks the channel up by id
 * and silently shows the app-level page instead when it does not exist, which reads as the row
 * being broken.
 *
 * `duty-status` is DELIBERATELY ABSENT. It is the LOW-importance notice that anchors the
 * foreground service, and dismissing or disabling it stops the service — which is the one thing
 * keeping a backgrounded app alive to receive work. Offering it here would be handing a driver a
 * switch whose real effect is "stop receiving trips", labelled as tidying up a notification.
 */
const NOTIFICATION_CHANNELS = [
  {
    channelId: OFFER_CHANNEL_ID,
    label: 'Trip offers',
    hint: 'The ringing alert when a customer books. Keep this on — it is how you get work.',
  },
  {
    channelId: DUTY_ALERT_CHANNEL_ID,
    label: 'Duty alerts',
    hint: 'Tells you when you have been taken offline and stopped receiving trips.',
  },
] as const;

/**
 * Open the system page for one channel, degrading rather than failing.
 *
 * Android's per-channel screen is the real control: sound, vibration, Do Not Disturb and whether
 * the channel delivers at all. None of that is ours to store — a channel's importance is fixed by
 * the OS on first creation (see `notifications/channel.ts`) and only the driver can change it.
 *
 * The fallbacks matter because OEM skins move these screens around. An unknown channel, or a skin
 * that does not implement the per-channel intent, lands on the app's own notification page, which
 * reaches the same settings in one more tap.
 */
async function openChannelSettings(channelId: string): Promise<void> {
  try {
    await notifee.openNotificationSettings(channelId);
  } catch {
    try {
      await notifee.openNotificationSettings();
    } catch {
      // Nothing left to try. Better a row that does nothing than a crash on the one screen a
      // driver opened because their alerts were already misbehaving.
    }
  }
}

/**
 * WHAT THESE ROWS USED TO BE: three switches held in local state, saving nothing and read by
 * nothing. Two of them named notifications this app has never sent — there is no earnings or
 * account-activity push anywhere in the API — so no amount of storage would have made them do
 * something. They are gone rather than persisted.
 *
 * The one real notification, the trip offer, is deliberately NOT given an in-app switch either.
 * Its off position means "stop sending me work", and a driver who flips it silently stops earning
 * and reports it as the app being broken. Android's own channel page is the honest place for
 * that decision: it is the switch that genuinely governs delivery, the OS shows plainly that
 * alerts are off, and nothing here has to pretend to own a setting it cannot enforce.
 */
function NotificationsBody(): ReactElement {
  return (
    <>
      <Text style={styles.body}>
        Alerts are controlled by Android, not by DriverZone. Each one below opens its own settings
        page, where you can change the sound, the vibration and whether it comes through Do Not
        Disturb.
      </Text>

      <View style={styles.spaced}>
        {NOTIFICATION_CHANNELS.map((item) => (
          <Pressable
            key={item.channelId}
            onPress={() => void openChannelSettings(item.channelId)}
            accessibilityRole="button"
            accessibilityLabel={`${item.label} notification settings`}
            style={({ pressed }) => [styles.toggleRow, pressed && styles.rowPressed]}
          >
            <View style={styles.flex}>
              <Text style={styles.optionLabel}>{item.label}</Text>
              <Text style={styles.toggleHint}>{item.hint}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.faint} />
          </Pressable>
        ))}
      </View>

      <Pressable
        onPress={() => router.push('/battery-setup')}
        accessibilityRole="button"
        style={styles.linkRow}
      >
        <Feather name="battery-charging" size={16} color={colors.fg} style={styles.contactIcon} />
        <Text style={styles.contactText}>Alert & battery setup</Text>
        <Feather name="chevron-right" size={16} color={colors.faint} />
      </Pressable>
      <Text style={styles.toggleHint}>
        Whether trip offers reach your phone at all also depends on your battery settings, which
        this checks for you.
      </Text>
    </>
  );
}

function HelpBody(): ReactElement {
  return (
    <>
      <Text style={styles.body}>
        Something not working, or a trip you need to ask about? Reach the DriverZone team directly
        — support is not automated.
      </Text>
      <Pressable
        onPress={() => void Linking.openURL('tel:+911234567890')}
        style={styles.contactRow}
      >
        <Feather name="phone" size={16} color={colors.fg} style={styles.contactIcon} />
        <Text style={styles.contactText}>+91 12345 67890</Text>
      </Pressable>
      <Pressable
        onPress={() => void Linking.openURL('mailto:support@driverzone.example')}
        style={styles.contactRow}
      >
        <Feather name="mail" size={16} color={colors.fg} style={styles.contactIcon} />
        <Text style={styles.contactText}>support@driverzone.example</Text>
      </Pressable>
      <DemoNotice>
        Placeholder contact details — swap these for the real support line before release.
      </DemoNotice>
    </>
  );
}

function StaticBody({ topic }: { topic: 'privacy' | 'terms' | 'about' }): ReactElement {
  if (topic === 'about') {
    return (
      <>
        <Text style={styles.body}>
          DriverZone connects customers who own a car with drivers for hire, by the hour or by the
          trip. This is the driver app.
        </Text>
        <Text style={[styles.body, styles.spaced]}>
          Version {Constants.expoConfig?.version ?? '—'}
        </Text>
      </>
    );
  }

  return (
    <>
      <DemoNotice>
        Placeholder text — replace with DriverZone&apos;s actual{' '}
        {topic === 'privacy' ? 'privacy policy' : 'terms and conditions'} before this ships.
      </DemoNotice>
      <Text style={styles.body}>
        {topic === 'privacy'
          ? 'This is where DriverZone would explain what driver data it collects, why, and how it is kept safe — your location while on duty, your uploaded documents, contact details, and trip and earnings history among them.'
          : 'This is where the terms a driver agrees to by using DriverZone would be set out — how trip offers and acceptance work, how cancellation penalties apply, how commission and payouts are handled, and what DriverZone is and is not responsible for.'}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

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

  content: { padding: space.lg },
  body: { ...text.body, color: colors.fg, lineHeight: 22 },
  spaced: { marginTop: space.md },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    backgroundColor: colors.bgSunken,
    borderRadius: 8,
    padding: space.sm,
    marginBottom: space.md,
  },
  noticeText: { ...text.caption, color: colors.muted, flex: 1 },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowPressed: { opacity: 0.6 },
  optionLabel: { ...text.body, color: colors.fg },
  toggleHint: { ...text.caption, color: colors.muted, marginTop: 2 },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    marginTop: space.md,
  },
  contactRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  contactIcon: { marginRight: space.sm },
  contactText: { ...text.body, color: colors.fg, flex: 1 },
});
