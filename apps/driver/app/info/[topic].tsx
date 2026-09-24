import { Feather } from '@expo/vector-icons';
import notifee from '@notifee/react-native';
import Constants from 'expo-constants';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DUTY_ALERT_CHANNEL_ID, OFFER_CHANNEL_ID } from '@/notifications/channel';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

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
        Need support with an assigned ride, duty dispatch, or payments — or have a question for our
        Siliguri operations desk? Reach the DriverZone team directly.
      </Text>

      <View style={styles.contactCard}>
        <Text style={styles.sectionHeading}>Driver Helpline Numbers</Text>
        <Pressable
          onPress={() => void Linking.openURL('tel:+918509299342')}
          style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
        >
          <Feather name="phone-call" size={16} color={colors.fg} style={styles.contactIcon} />
          <Text style={styles.contactText}>+91 85092 99342 (Dispatch)</Text>
        </Pressable>
        <Pressable
          onPress={() => void Linking.openURL('tel:+917001606510')}
          style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
        >
          <Feather name="phone" size={16} color={colors.fg} style={styles.contactIcon} />
          <Text style={styles.contactText}>+91 70016 06510 (Operations)</Text>
        </Pressable>

        <Text style={[styles.sectionHeading, styles.spaced]}>Support Email</Text>
        <Pressable
          onPress={() => void Linking.openURL('mailto:support@driverzoneonline.com')}
          style={({ pressed }) => [styles.contactRow, pressed && styles.rowPressed]}
        >
          <Feather name="mail" size={16} color={colors.fg} style={styles.contactIcon} />
          <Text style={styles.contactText}>support@driverzoneonline.com</Text>
        </Pressable>

        <Text style={[styles.sectionHeading, styles.spaced]}>Operations Desk</Text>
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
        <Text style={styles.leadText}>DriverZone Driver — Partner App</Text>
        <Text style={styles.body}>
          DriverZone connects professional, verified car chauffeurs with private car owners across Siliguri, North Bengal, Darjeeling, and Sikkim.
        </Text>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>Trip Categories Available</Text>
          <BulletList
            items={[
              'Local city travel across Siliguri & Dabgram municipal limits',
              'Mountain & hill tours (Darjeeling, Kurseong, Kalimpong, Gangtok, Mirik)',
              'Bagdogra Airport (IXB) & NJP railway transfers',
              'Long-distance outstation journeys (NH-27 / NH-31 corridors)',
              'Monthly dedicated private chauffeur placements',
            ]}
          />
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>Enterprise Credibility</Text>
          <BulletList
            items={[
              'GST registered enterprise in West Bengal',
              'MSME & Udyam certified by Govt. of India',
              'Verified municipal trade licence (Siliguri, WB)',
              'Police-verified chauffeur community',
            ]}
          />
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>Operations Desk</Text>
          <Text style={styles.sectionBody}>
            Near Uttarbanga Sangbad Office, Banipukur Road, Middle Shanti Nagar, Loknath Mandir Road,
            Dabgram, Siliguri, West Bengal – 734004
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
          DriverZone Driver App · v{Constants.expoConfig?.version ?? '1.0.0'}
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

        <Text style={styles.leadText}>Driver Privacy Policy — DriverZone</Text>
        <Text style={styles.body}>
          DriverZone (&quot;Company&quot;, &quot;we&quot;, &quot;us&quot;) is committed to protecting the privacy of our partner drivers. This policy details how your personal information, location coordinates, and verification documents are processed.
        </Text>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>1. Information We Collect from Drivers</Text>
          <BulletList
            items={[
              'Identity & documents: full name, mobile number, driving licence, PAN/Aadhaar verification details, and profile photo.',
              'Location while on duty: collected in real time, including when the app is in the background, strictly while you are on duty. This matches you to nearby trip offers and restores your duty status if your phone restarts. Collection stops immediately when you toggle Off Duty.',
              'Device & push token: Firebase notification token, to ring trip offers on your handset.',
              'Earnings & trip ledger: completed trips, hours logged, fares, and payout history.',
            ]}
          />
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>2. Strict No-Data-Selling Policy</Text>
          <Text style={styles.sectionBody}>
            We never sell, rent, trade, or distribute your personal documents, phone number, or location records to third-party telemarketers, brokers, or advertisers under any circumstances.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>3. Shared Data During Trips</Text>
          <Text style={styles.sectionBody}>
            When an offer is accepted, your verified name, photograph, phone number, and real-time transit location are shared with the booking customer for the duration of that ride only. Customers cannot view your full trip history or earnings.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>4. Document Storage & Security</Text>
          <Text style={styles.sectionBody}>
            Driver documents are uploaded over secure TLS connections and stored in encrypted cloud storage. Access is strictly restricted to authorized compliance officers for verification.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>5. Account & Data Deletion</Text>
          <Text style={styles.sectionBody}>
            Drivers may request full account deletion through the app (Profile → Delete Account) or online at www.driverzoneonline.com/delete-account. Historical tax and statutory dispute records are retained only as mandated by Indian law.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>6. Grievance Officer & Contact</Text>
          <Text style={styles.sectionBody}>
            Data Privacy & Grievance Manager, DriverZone{'\n'}
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

      <Text style={styles.leadText}>Driver Terms & Conditions — DriverZone</Text>
      <Text style={styles.body}>
        These Terms govern your partnership as a verified chauffeur with DriverZone in Siliguri and surrounding areas.
      </Text>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>1. Driver Qualifications & Licensing</Text>
        <Text style={styles.sectionBody}>
          Every driver must hold a valid, unexpired Commercial or Personal Driving Licence issued by an Indian RTO. Drivers must pass DriverZone&apos;s practical hill/city driving evaluation and police verification before receiving work.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>2. Vehicle Inspection & Customer Ownership</Text>
        <Text style={styles.sectionBody}>
          Drivers operate customer-owned vehicles. Before starting, the driver must conduct a walkaround inspection to verify tire condition, fuel level, and visible scratches. Any preexisting vehicle damage must be communicated to the customer prior to departure.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>3. Trip Fares, Night & Outstation Allowances</Text>
        <BulletList
          items={[
            'Fares are calculated transparently per package or distance band, in Indian Rupees (INR - ₹).',
            'Night allowance: ₹200 applies for duty extending between 10:00 PM and 6:00 AM.',
            'Outstation night halt: where customer lodging is not provided, a driver night allowance of ₹300 per night applies.',
            'Overtime hours beyond package limits are credited at declared hourly rates.',
          ]}
        />
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>4. Sobriety & Road Safety (Zero Tolerance)</Text>
        <Text style={styles.sectionBody}>
          DriverZone enforces strict zero-tolerance policies against driving under the influence of alcohol or narcotics. Drivers must adhere strictly to speed limits, wear seatbelts, and observe mountain driving safety protocols on Darjeeling and Sikkim routes.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>5. Cancellation & Refunds</Text>
        <Text style={styles.sectionBody}>
          Customer cancellations made 2 or more hours prior receive full refund. Repeated unwarranted rejection or abandonment of accepted trips by a driver may result in temporary duty suspension.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>6. Insurance & Traffic Violations</Text>
        <Text style={styles.sectionBody}>
          Customer vehicle damage during unforeseen road events is covered under the vehicle owner&apos;s Comprehensive Motor Insurance. Challans caused by direct driver misconduct (e.g. red-light jump, wrongful parking) are the driver&apos;s responsibility; challans due to expired vehicle papers or customer instruction are not.
        </Text>
      </View>

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>7. Governing Law & Jurisdiction</Text>
        <Text style={styles.sectionBody}>
          These Terms are governed by Indian law. The courts of Siliguri / Jalpaiguri District, West
          Bengal, have exclusive jurisdiction over disputes.
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
