import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { PAYMENT_METHODS } from '@/features/profile/completion';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * One route standing in for six Account-tab rows that have nothing behind them yet:
 * Preferred Payment Method, Notifications, Help & Support, Privacy Policy, Terms & Conditions,
 * About DriverZone. None of these has an API surface today — no stored payment preference, no
 * notification settings, no CMS-backed legal or help content — so a single generic screen beats
 * six near-identical files, and the ones with a real answer coming (payment, notifications) say
 * so plainly rather than pretending a local toggle is a saved setting.
 */
const TOPICS = ['payment-method', 'notifications', 'help', 'privacy', 'terms', 'about'] as const;
type Topic = (typeof TOPICS)[number];

const TITLES: Record<Topic, string> = {
  'payment-method': 'Preferred Payment Method',
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
        ) : topic === 'payment-method' ? (
          <PaymentMethodBody />
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
 * LOCAL STATE ONLY. There is no field on `CustomerProfileDto` for a payment preference, and
 * every booking today books in `CASH` regardless of anything picked here (`FareSheet.tsx`) — so
 * this choice is not sent anywhere and does not change what happens at Confirm. Shown honestly
 * rather than hidden, because the row exists in the design and a missing screen reads as broken.
 */
function PaymentMethodBody(): ReactElement {
  const [selected, setSelected] = useState<string>('CASH');

  return (
    <>
      <DemoNotice>
        This choice is not saved yet — bookings currently always go through as cash, regardless of
        what you pick here.
      </DemoNotice>
      {PAYMENT_METHODS.map((method) => {
        const active = method.value === selected;
        return (
          <Pressable
            key={method.value}
            onPress={() => setSelected(method.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            style={[styles.optionRow, active && styles.optionRowActive]}
          >
            <Text style={styles.optionLabel}>{method.label}</Text>
            {active ? <Feather name="check-circle" size={18} color={colors.fg} /> : null}
          </Pressable>
        );
      })}
    </>
  );
}

const NOTIFICATION_TOGGLES = [
  { key: 'booking', label: 'Booking updates', hint: 'Driver assigned, arriving, trip started' },
  { key: 'promo', label: 'Offers & promotions', hint: 'Occasional discounts and news' },
  { key: 'account', label: 'Account activity', hint: 'Sign-ins and profile changes' },
] as const;

/** LOCAL STATE ONLY — there is no notification-preferences endpoint to read from or write to. */
function NotificationsBody(): ReactElement {
  const [state, setState] = useState<Record<string, boolean>>({
    booking: true,
    promo: false,
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
    </>
  );
}

function HelpBody(): ReactElement {
  return (
    <>
      <Text style={styles.body}>
        Something not working, or a trip you need to ask about? Reach the DriverZone team directly —
        support is not automated.
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
          trip.
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
          ? 'This is where DriverZone would explain what customer data it collects, why, and how it is kept safe — location while booking, contact details, and trip history among them.'
          : 'This is where the terms a customer agrees to by using DriverZone would be set out — how bookings work, how cancellation fees apply, and what DriverZone is and is not responsible for.'}
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
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.md,
  },
  noticeText: { ...text.caption, color: colors.muted, flex: 1 },

  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: space.sm,
  },
  optionRowActive: { borderColor: colors.fg, backgroundColor: colors.bgSunken },
  optionLabel: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  toggleHint: { ...text.caption, color: colors.muted, marginTop: 1 },

  contactRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.md },
  contactIcon: { marginRight: space.sm },
  contactText: { ...text.body, color: colors.fg },
});
