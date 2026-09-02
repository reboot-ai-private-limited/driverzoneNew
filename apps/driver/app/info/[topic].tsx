import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { colors, space, text } from '@/theme/theme';

/**
 * One route standing in for the Account-tab rows that have nothing behind them yet:
 * Notifications, Help & Support, Privacy Policy, Terms & Conditions, About DriverZone. None has
 * an API surface today — no notification settings, no CMS-backed legal or help content — so a
 * single generic screen beats five near-identical files, and the one with a real answer coming
 * (notifications) says so plainly rather than pretending a local toggle is a saved setting.
 *
 * Deliberately mirrors `apps/customer/app/info/[topic].tsx` — the two apps should read the same.
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

const NOTIFICATION_TOGGLES = [
  { key: 'offers', label: 'Trip offers', hint: 'The ringing alert when a customer books' },
  { key: 'earnings', label: 'Earnings & payouts', hint: 'Daily totals and payout confirmations' },
  { key: 'account', label: 'Account activity', hint: 'Sign-ins and document status changes' },
] as const;

/**
 * LOCAL STATE ONLY — there is no notification-preferences endpoint to read from or write to.
 *
 * The one that matters, "Trip offers", is also the one a switch here cannot really turn off in a
 * way that helps: an offer that does not ring is a driver who misses work. So it points at the
 * battery-and-alert setup instead, which is the setting that actually governs whether offers
 * reach the phone.
 */
function NotificationsBody(): ReactElement {
  const [state, setState] = useState<Record<string, boolean>>({
    offers: true,
    earnings: true,
    account: true,
  });

  return (
    <>
      <DemoNotice>
        These switches are not saved — there is nowhere on the server yet for a notification
        preference to live.
      </DemoNotice>

      {NOTIFICATION_TOGGLES.map((item) => (
        <View key={item.key} style={styles.toggleRow}>
          <View style={styles.flex}>
            <Text style={styles.optionLabel}>{item.label}</Text>
            <Text style={styles.toggleHint}>{item.hint}</Text>
          </View>
          <Switch
            value={state[item.key] ?? false}
            onValueChange={(next) => setState((prev) => ({ ...prev, [item.key]: next }))}
            trackColor={{ false: colors.border, true: colors.brand }}
            thumbColor={colors.card}
          />
        </View>
      ))}

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
        Whether trip offers actually reach your phone is controlled here, not by the switch above.
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
