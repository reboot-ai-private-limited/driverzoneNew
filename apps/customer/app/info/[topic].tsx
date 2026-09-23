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

/** A `•` prefix baked into a wrapping paragraph's text left every continuation line flush with the
 *  bullet instead of the text that follows it. Each item gets its own row so wraps hang correctly. */
function BulletList({ items }: { items: string[] }): ReactElement {
  return (
    <View style={styles.bulletList}>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
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
        Need help with a booking, a billing question, or want to speak with our dispatch desk? Reach the
        DriverZone team directly in Siliguri.
      </Text>

      <View style={styles.contactCard}>
        <Text style={styles.sectionHeading}>Contact Numbers</Text>
        <Pressable
          onPress={() => void Linking.openURL('tel:+918509299342')}
          style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
        >
          <Feather name="phone-call" size={16} color={colors.fg} style={styles.contactIcon} />
          <Text style={styles.contactText}>+91 85092 99342 (Primary)</Text>
        </Pressable>
        <Pressable
          onPress={() => void Linking.openURL('tel:+917001606510')}
          style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
        >
          <Feather name="phone" size={16} color={colors.fg} style={styles.contactIcon} />
          <Text style={styles.contactText}>+91 70016 06510 (Support)</Text>
        </Pressable>

        <Text style={[styles.sectionHeading, styles.spaced]}>Email Support</Text>
        <Pressable
          onPress={() => void Linking.openURL('mailto:support@driverzoneonline.com')}
          style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
        >
          <Feather name="mail" size={16} color={colors.fg} style={styles.contactIcon} />
          <Text style={styles.contactText}>support@driverzoneonline.com</Text>
        </Pressable>

        <Text style={[styles.sectionHeading, styles.spaced]}>Registered Office</Text>
        <View style={styles.contactRow}>
          <Feather name="map-pin" size={16} color={colors.fg} style={styles.contactIcon} />
          <Text style={[styles.contactText, styles.addressText]}>
            Near Uttarbanga Sangbad Office, Banipukur Road, Middle Shanti Nagar, Loknath Mandir Road,
            Dabgram, Siliguri, West Bengal – 734004
          </Text>
        </View>

        <Text style={[styles.sectionHeading, styles.spaced]}>Website</Text>
        <Pressable
          onPress={() => void Linking.openURL('https://www.driverzoneonline.com')}
          style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
        >
          <Feather name="globe" size={16} color={colors.link} style={styles.contactIcon} />
          <Text style={[styles.contactText, { color: colors.link }]}>www.driverzoneonline.com</Text>
        </Pressable>
      </View>
    </>
  );
}

function StaticBody({ topic }: { topic: 'privacy' | 'terms' | 'about' }): ReactElement {
  if (topic === 'about') {
    return (
      <View style={styles.legalContent}>
        <Text style={styles.leadText}>Your Car. Our Driver. Your Journey.</Text>
        <Text style={styles.body}>
          DriverZone is Siliguri&apos;s most trusted chauffeur network, connecting car owners with
          verified, professional, police-cleared drivers for hire by the hour or by the trip.
        </Text>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>Services Offered</Text>
          <BulletList
            items={[
              'Local city travel across Siliguri & Dabgram municipal limits',
              'Mountain & hill tours (Darjeeling, Kurseong, Kalimpong, Gangtok, Mirik)',
              'Airport transfers (Bagdogra IXB) & railway transfers (NJP Station)',
              'Outstation & intercity highway travel across North Bengal, Sikkim, and Assam',
              'Monthly corporate & personal chauffeur subscriptions',
            ]}
          />
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>Certifications & Compliance</Text>
          <BulletList
            items={[
              'GST registered enterprise',
              'MSME & Udyam certified (Govt. of India)',
              'Verified municipal trade licence (Siliguri, WB)',
              'Background-checked and road-tested chauffeurs',
            ]}
          />
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>Headquarters</Text>
          <Text style={styles.sectionBody}>
            Near Uttarbanga Sangbad Office, Banipukur Road, Middle Shanti Nagar, Loknath Mandir Road, Dabgram, Siliguri, West Bengal – 734004
          </Text>
          <Pressable
            onPress={() => void Linking.openURL('https://www.driverzoneonline.com')}
            style={({ pressed }) => [styles.webLinkRow, pressed && styles.rowPressed]}
          >
            <Feather name="external-link" size={14} color={colors.link} style={{ marginRight: 6 }} />
            <Text style={styles.webLinkText}>Visit www.driverzoneonline.com</Text>
          </Pressable>
        </View>

        <Text style={[styles.body, styles.versionFooter]}>
          DriverZone Customer App · v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </View>
    );
  }

  if (topic === 'privacy') {
    return (
      <View style={styles.legalContent}>
        <View style={styles.metaBadge}>
          <Text style={styles.metaBadgeText}>Effective Date: January 1, 2026</Text>
        </View>

        <Text style={styles.leadText}>Privacy Policy — DriverZone Siliguri</Text>
        <Text style={styles.body}>
          DriverZone (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;), operating www.driverzoneonline.com and the DriverZone mobile applications, is strictly committed to protecting the privacy and personal data of our customers and vehicle owners.
        </Text>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>1. Information We Collect</Text>
          <BulletList
            items={[
              'Contact details: your full name, mobile number, and optional profile details.',
              'Location: collected while the app is active in the foreground, to pinpoint your pickup point, match nearby drivers, and monitor trip progress. We do not collect your location in the background.',
              'Vehicle details: make, model, and transmission, to assign an appropriately trained chauffeur.',
              'Booking & transaction metadata: trip reference, schedule, pickup/drop coordinates, and payment receipts.',
            ]}
          />
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>2. Strict No-Data-Selling Policy</Text>
          <Text style={styles.sectionBody}>
            We do NOT sell, rent, trade, lease, or monetize your personal data to third-party telemarketers, advertising agencies, or data brokers under any circumstances. Your data is used exclusively to fulfill your driver bookings and related customer support.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>3. Payment Security & Razorpay PCI-DSS</Text>
          <Text style={styles.sectionBody}>
            All digital payments are processed through Razorpay Software Private Limited, a PCI-DSS Level 1 certified payment aggregator. DriverZone does not store or view your sensitive card numbers, CVV codes, UPI PINs, or net banking passwords. All data is encrypted using 128-bit / 256-bit SSL protocols.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>4. Purposes of Data Processing</Text>
          <BulletList
            items={[
              'Allocating the nearest qualified chauffeur to your doorstep.',
              'Sharing verified driver details and ETA updates.',
              'Issuing GST-compliant invoices.',
              'Processing authorised refunds as per our cancellation guidelines.',
              'Responding to safety concerns and resolving transit grievances.',
            ]}
          />
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>5. Account & Data Deletion</Text>
          <Text style={styles.sectionBody}>
            You have the right to delete your account and personal details at any time. You can initiate instant deletion within the app under Profile → Delete Account, or request deletion online at www.driverzoneonline.com/delete-account.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>6. Grievance Officer & Contact</Text>
          <Text style={styles.sectionBody}>
            Grievance Officer, DriverZone{'\n'}
            Near Uttarbanga Sangbad Office, Banipukur Road, Middle Shanti Nagar, Loknath Mandir Road,
            Dabgram, Siliguri, West Bengal – 734004
          </Text>
          <Pressable
            onPress={() => void Linking.openURL('mailto:support@driverzoneonline.com')}
            style={({ pressed }) => [styles.webLinkRow, pressed && styles.rowPressed]}
          >
            <Feather name="mail" size={14} color={colors.link} style={{ marginRight: 6 }} />
            <Text style={styles.webLinkText}>support@driverzoneonline.com</Text>
          </Pressable>
          <Pressable
            onPress={() => void Linking.openURL('tel:+918509299342')}
            style={({ pressed }) => [styles.webLinkRow, pressed && styles.rowPressed]}
          >
            <Feather name="phone-call" size={14} color={colors.link} style={{ marginRight: 6 }} />
            <Text style={styles.webLinkText}>+91 85092 99342</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // topic === 'terms'
  return (
    <View style={styles.legalContent}>
      <View style={styles.metaBadge}>
        <Text style={styles.metaBadgeText}>Last Updated: September 2026</Text>
      </View>

      <Text style={styles.leadText}>Terms & Conditions — DriverZone</Text>
      <Text style={styles.body}>
        These Terms govern on-demand chauffeur hire services operated by DriverZone (Siliguri, West Bengal). By booking a driver, you agree to comply with and be bound by these conditions.
      </Text>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>1. Scope of Service: Customer&apos;s Own Vehicle</Text>
        <Text style={styles.sectionBody}>
          DriverZone provides professional chauffeurs to operate vehicles owned, rented, or leased by the Customer. We do not provide rental cars. Fuel, road taxes, tolls, parking fees, and vehicle maintenance remain the sole responsibility of the vehicle owner.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>2. Vehicle Roadworthiness & Documents</Text>
        <Text style={styles.sectionBody}>
          Before handing over keys, the Customer warrants that the vehicle possesses valid Registration (RC), Comprehensive Motor Insurance, and Pollution Under Control (PUC) certificates. Brakes, steering, tires (including spare), headlights, and wipers must be in sound operating condition. For mountain travel, cooling and braking systems must satisfy hill safety standards.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>3. Pricing & Night / Outstation Allowances</Text>
        <Text style={styles.sectionBody}>
          All tariffs are billed in Indian Rupees (INR - ₹) with GST compliance. Night allowance of ₹200 applies for duties extending between 10:00 PM and 6:00 AM. For outstation journeys or hill tours requiring overnight halt where lodging is not provided, a driver night allowance of ₹300/night applies.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>4. Cancellation & Refund Policy (Razorpay)</Text>
        <Text style={styles.sectionBody}>
          Cancellations made 2 hours or more prior to the scheduled pickup time receive a 100% full refund. Refunds are credited to the original payment source within 5 to 7 working days via Razorpay.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>5. Customer Conduct & Safety</Text>
        <Text style={styles.sectionBody}>
          Customers agree not to instruct the chauffeur to violate traffic rules, exceed speed limits, or carry illegal contraband or alcohol in violation of state excise laws. Mutual courtesy and safety are mandatory.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>6. Limitation of Liability & Insurance</Text>
        <Text style={styles.sectionBody}>
          Vehicle damage in unforeseen road incidents is governed primarily by the vehicle&apos;s own Comprehensive Motor Insurance. Traffic challans resulting directly from driver negligence are borne by DriverZone; challans arising from expired vehicle documentation or passenger insistence remain the customer&apos;s responsibility.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>7. Governing Law & Jurisdiction</Text>
        <Text style={styles.sectionBody}>
          These Terms are governed by the laws of India. The courts and consumer forums of Siliguri /
          Jalpaiguri District, West Bengal, hold exclusive jurisdiction.
        </Text>
      </View>
    </View>
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

  content: { padding: space.lg, paddingBottom: space.xl },
  body: { ...text.body, color: colors.fg, lineHeight: 22 },
  leadText: { ...text.heading, color: colors.fg, fontSize: 16, marginBottom: space.sm },
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

  rowPressed: { opacity: 0.6 },

  contactCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    marginTop: space.lg,
  },
  contactRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.sm },
  contactIcon: { marginRight: space.sm, marginTop: 3 },
  contactText: { ...text.body, color: colors.fg, flex: 1, lineHeight: 20 },
  addressText: { fontSize: 13, color: colors.muted },

  legalContent: { marginTop: space.xs },
  metaBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bgSunken,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    marginBottom: space.md,
  },
  metaBadgeText: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },

  policySection: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginTop: space.md,
  },
  sectionHeading: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, marginBottom: space.xs },
  sectionBody: { ...text.body, color: colors.muted, fontSize: 13, lineHeight: 20 },

  bulletList: { marginTop: 2 },
  bulletRow: { flexDirection: 'row', marginTop: space.xs },
  bulletMark: { ...text.body, color: colors.muted, fontSize: 13, lineHeight: 20, marginRight: space.xs },
  bulletText: { ...text.body, color: colors.muted, fontSize: 13, lineHeight: 20, flex: 1 },

  webLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.xs,
  },
  webLinkText: { ...text.caption, color: colors.link, fontFamily: fontFamily.semibold },
  versionFooter: { marginTop: space.xl, textAlign: 'center', color: colors.muted, fontSize: 12 },
});
