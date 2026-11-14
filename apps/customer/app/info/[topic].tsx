import { Feather } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router, useLocalSearchParams } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { CUSTOMER_TERMS, type TermsBlock } from '@/features/legal/customerTerms';
import { getProfile, updateProfile } from '@/lib/api/endpoints/customer';
import { PRIVACY_URL } from '@/lib/config';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * One route for five Account-tab rows: Notifications, Help & Support, Privacy Policy,
 * Terms & Conditions, About DriverZone. Only Notifications talks to the API (the WhatsApp offers
 * preference); the rest is static content, so one generic screen beats five near-identical files.
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
 * Notification preferences that are actually saved.
 *
 * Booking updates and sign-in codes are TRANSACTIONAL — the service cannot work without them — so
 * they are explained, not offered as a switch. The one real choice is optional WhatsApp
 * promotional messages, stored on the profile (`whatsapp_marketing_opt_in`) and off by default.
 */
function NotificationsBody(): ReactElement {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });
  const [error, setError] = useState<string | null>(null);

  const toggle = useMutation({
    mutationFn: (next: boolean) => updateProfile({ whatsapp_marketing_opt_in: next }),
    onMutate: () => setError(null),
    onSuccess: (updated) => queryClient.setQueryData(keys.profile.me(), updated),
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : 'Could not save your choice. Please try again.'),
  });

  const optedIn = toggle.isPending
    ? (toggle.variables ?? false)
    : (profile.data?.whatsapp_marketing_opt_in ?? false);

  return (
    <>
      <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text style={styles.optionLabel}>Booking updates &amp; sign-in codes</Text>
          <Text style={styles.toggleHint}>
            Always on. Sign-in codes and updates about your bookings (driver assigned, arriving,
            trip completed) are sent by app notification and WhatsApp, because the service needs
            them to work.
          </Text>
        </View>
      </View>

      <View style={styles.toggleRow}>
        <View style={styles.flex}>
          <Text style={styles.optionLabel}>Offers on WhatsApp</Text>
          <Text style={styles.toggleHint}>
            Optional. Occasional promotional offers from DriverZone. You can turn this off at any
            time.
          </Text>
        </View>
        {profile.isPending ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <Switch
            value={optedIn}
            disabled={profile.isError || toggle.isPending}
            onValueChange={(next) => toggle.mutate(next)}
            trackColor={{ false: colors.border, true: colors.brand }}
            thumbColor={colors.card}
            accessibilityLabel="Send me promotional offers on WhatsApp"
          />
        )}
      </View>

      {profile.isError ? (
        <Text style={styles.errorText}>We could not load your preferences. Please try again later.</Text>
      ) : null}
      {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
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

/** Shown at the foot of the in-app Privacy Policy and Terms, as on the website. */
function PublisherDisclosure(): ReactElement {
  return (
    <View style={styles.policySection}>
      <Text style={styles.sectionHeading}>Platform &amp; Publisher Disclosure</Text>
      <Text style={styles.sectionBody}>
        The Driver Zone mobile applications on the Apple App Store and Google Play Store are
        officially developed, published, and technically maintained by our authorized technology
        partner, Reboot AI Private Limited, on behalf of Driver Zone.
      </Text>
    </View>
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
              'Vehicle details: the car type, registration (plate) number and fuel type of the cars you save, so the driver knows which car to drive.',
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
          <Text style={styles.sectionHeading}>5. WhatsApp Messages</Text>
          <Text style={styles.sectionBody}>
            Sign-in codes and updates about your bookings are sent on WhatsApp because the service
            needs them. Promotional offers on WhatsApp are sent only if you opt in — the box on the
            sign-in screen is optional and unticked by default — and you can withdraw at any time
            under Profile → Notifications.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>6. Account & Data Deletion</Text>
          <Text style={styles.sectionBody}>
            You have the right to delete your account and personal details at any time. You can initiate instant deletion within the app under Profile → Delete Account, or request deletion online at www.driverzoneonline.com/delete-account.
          </Text>
        </View>

        <View style={styles.policySection}>
          <Text style={styles.sectionHeading}>7. Grievance Officer & Contact</Text>
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
          <Pressable
            onPress={() => void Linking.openURL(PRIVACY_URL)}
            style={({ pressed }) => [styles.webLinkRow, pressed && styles.rowPressed]}
          >
            <Feather name="globe" size={14} color={colors.link} style={{ marginRight: 6 }} />
            <Text style={styles.webLinkText}>Full policy at driverzoneonline.com/privacy</Text>
          </Pressable>
        </View>

        <PublisherDisclosure />
      </View>
    );
  }

  // topic === 'terms' — the copy lives in `customerTerms.ts`; this only lays it out.
  const terms = CUSTOMER_TERMS;
  return (
    <View style={styles.legalContent}>
      <View style={styles.metaBadge}>
        <Text style={styles.metaBadgeText}>
          Effective Date: {terms.effectiveDate} · Version {terms.version}
        </Text>
      </View>

      <Text style={styles.leadText}>Customer Terms & Conditions — Driver Zone</Text>
      <Text style={styles.metaLine}>Jurisdiction: {terms.jurisdiction}</Text>
      <Text style={styles.body}>{terms.intro}</Text>

      {terms.sections.map((section) => (
        <View key={section.heading} style={styles.policySection}>
          <Text style={styles.sectionHeading}>{section.heading}</Text>
          {section.blocks.map((block) => (
            <TermsBlockView key={termsBlockKey(block)} block={block} />
          ))}
        </View>
      ))}

      <View style={styles.policySection}>
        <Text style={styles.sectionHeading}>Customer Acceptance</Text>
        <Text style={styles.sectionBody}>{terms.acceptance}</Text>
      </View>

      {terms.closing.map((line) => (
        <Text key={line} style={styles.closingText}>
          {line}
        </Text>
      ))}

      <PublisherDisclosure />
    </View>
  );
}

/** Every block's own first line is unique within its section, so it doubles as the React key. */
function termsBlockKey(block: TermsBlock): string {
  switch (block.kind) {
    case 'p':
    case 'subheading':
      return `${block.kind}:${block.text}`;
    case 'bullets':
      return `bullets:${block.items[0] ?? ''}`;
    case 'labelled':
      return `labelled:${block.items[0]?.label ?? ''}`;
  }
}

function TermsBlockView({ block }: { block: TermsBlock }): ReactElement {
  switch (block.kind) {
    case 'p':
      return <Text style={[styles.sectionBody, styles.blockGap]}>{block.text}</Text>;
    case 'subheading':
      return <Text style={styles.subheading}>{block.text}</Text>;
    case 'bullets':
      return <BulletList items={block.items} />;
    case 'labelled':
      return (
        <View style={styles.bulletList}>
          {block.items.map((item) => (
            <View key={item.label} style={styles.bulletRow}>
              <Text style={styles.bulletMark}>•</Text>
              <Text style={styles.bulletText}>
                <Text style={styles.bulletLabel}>{item.label}: </Text>
                {item.text}
              </Text>
            </View>
          ))}
        </View>
      );
  }
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

  errorText: { ...text.caption, color: colors.danger, marginTop: space.sm },
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
  bulletLabel: { fontFamily: fontFamily.semibold, color: colors.fg },
  blockGap: { marginTop: space.xs },
  subheading: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold, marginTop: space.sm },
  metaLine: { ...text.caption, color: colors.muted, marginBottom: space.sm },
  closingText: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.md },

  webLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: space.sm,
    paddingTop: space.xs,
  },
  webLinkText: { ...text.caption, color: colors.link, fontFamily: fontFamily.semibold },
  versionFooter: { marginTop: space.xl, textAlign: 'center', color: colors.muted, fontSize: 12 },
});
