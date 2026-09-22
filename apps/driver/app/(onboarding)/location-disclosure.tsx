import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  markBackgroundLocationAccepted,
  markBackgroundLocationDeclined,
} from '@/features/onboarding/backgroundLocationDisclosure';
import { colors, radius, shadow, space, text } from '@/theme/theme';

/**
 * THE PROMINENT DISCLOSURE SCREEN — shown once, immediately before Android's background-location
 * prompt, because Play's Location Permissions policy requires exactly that.
 *
 * See [[backgroundLocationDisclosure]] for the policy text this is written against and for the
 * gate that makes the ordering guaranteed rather than merely intended. In short: the OS prompt is
 * locked behind a stored flag, and `accept()` below is the only writer of it.
 *
 * **Reached from the duty toggle, not from `/gate`.** A driver meets this the first time they go
 * on duty rather than during onboarding, and that is the point — the disclosure has to be
 * adjacent to the feature it is disclosing, so "while you are on duty" is a sentence about what
 * the driver is doing right now instead of an abstraction about what the app might do later. It
 * also means a driver who never goes on duty is never asked, which is correct: nothing collects
 * their location.
 *
 * **Both buttons genuinely decide something**, which the policy requires and which is also just
 * true here: declining costs the restart path (see the background-permission comment in
 * `dutyForegroundService.ts`), not the shift. The screen says so plainly rather than implying
 * that refusing breaks the app — a disclosure that overstates the consequence to get a grant is
 * the thing the policy is defending against.
 *
 * **No back arrow, no swipe-to-dismiss.** The header is deliberately bare and the stack option
 * `gestureEnabled: false` is set in the layout, because a disclosure that can be dismissed
 * without answering is one Android can then prompt behind — and a reviewer will try it.
 */
export default function LocationDisclosureScreen(): ReactElement {
  const [busy, setBusy] = useState(false);

  /**
   * Allow — record the consent, THEN prompt.
   *
   * The write is awaited before the prompt for a reason that only shows up in the bad case: if
   * the driver backgrounds the app on the system settings page Android sends them to, this
   * process can be killed before `requestBackgroundPermissionsAsync` resolves. Having written the
   * flag first means the grant they make over there is not followed, on the next launch, by this
   * screen asking them for it all over again.
   */
  function accept(): void {
    void (async () => {
      setBusy(true);
      try {
        await markBackgroundLocationAccepted();
        /*
         * On Android 11+ this is not a dialog but a trip to the system settings page for "Allow
         * all the time". The result is not read: the duty flow already treats background location
         * as optional, and re-checking here would only let this screen contradict it.
         */
        await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
      } finally {
        setBusy(false);
        leave();
      }
    })();
  }

  function decline(): void {
    void markBackgroundLocationDeclined().then(leave);
  }

  function leave(): void {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Location while on duty</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.leadIcon}>
          <Feather name="map-pin" size={26} color={colors.fg} />
        </View>

        <Text style={styles.title}>DriverZone needs your location in the background</Text>

        {/*
          The three sentences the policy asks for, kept as three separate lines rather than one
          paragraph: what is collected, that it happens in the background, and what it is for.
          A reviewer reads this against the declaration form, so the wording here and the wording
          there should not drift apart.
        */}
        <Text style={styles.lead}>
          While you are on duty, DriverZone collects your location — including when the app is
          closed or not in use — so that trip offers near you keep reaching your phone.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardHeading}>What this is for</Text>

          <Bullet icon="bell">
            Offers keep ringing when your screen is off or DriverZone is in the background.
          </Bullet>
          <Bullet icon="refresh-cw">
            You are brought back online automatically if your phone restarts or Android closes the
            app mid-shift.
          </Bullet>
          <Bullet icon="pause-circle">
            Nothing is collected once you go off duty. Your location is used for dispatch only and
            is never sold.
          </Bullet>
        </View>

        {/*
          The honest version of the consequence. `dutyForegroundService.ts` runs the shift on the
          foreground grant alone, so this is genuinely optional — and saying so is what makes
          "Not now" a real choice rather than a button nobody is expected to press.
        */}
        <Text style={styles.hint}>
          You can say no and still work — offers will still reach you while DriverZone is running.
          You may be taken offline if Android closes the app while your screen is locked. You can
          change this at any time in your phone&apos;s Settings.
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
