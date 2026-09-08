import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  isBatteryOptimisationActive,
  markBatterySetupConfirmed,
  markBatterySetupSeen,
} from '@/features/onboarding/batteryOptimisation';
import {
  detectOemFamily,
  guideFor,
  hasPowerManager,
  openAutostartSettings,
  openBatterySettings,
} from '@/features/onboarding/oemIntents';
import { openFullScreenIntentSettings } from '@/notifications/fullScreenIntent';
import { colors, radius, shadow, space, text } from '@/theme/theme';

/**
 * S-12 — the OEM battery-optimisation walkthrough.
 *
 * `mobile-in-monorepo.md`: "the highest-leverage screen in the driver app… the difference
 * between a driver app that receives offers and one that doesn't." On the OEM skins that make up
 * most of the Indian market, a backgrounded app is killed and its notifications dropped unless
 * the driver lifts a restriction the manufacturer buried. Nothing the app can do at runtime
 * substitutes for that setting.
 *
 * The screen is reached three ways: forced once out of `/gate` after the first approval, from
 * the Home banner while it is still unconfirmed, and from Account any time after. So the
 * navigation adapts — a back arrow when there is somewhere to go back to, "Do this later"
 * otherwise.
 *
 * **The written steps are the payload; the buttons are shortcuts.** Every deep link in
 * `oemIntents.ts` is best-effort and silently falls back to this app's settings page, because
 * the OEM activity names it targets get renamed between skin versions.
 */
export default function BatterySetupScreen(): ReactElement {
  const family = useMemo(detectOemFamily, []);
  const guide = guideFor(family);
  const [busy, setBusy] = useState<'battery' | 'autostart' | 'fullscreen' | null>(null);

  /**
   * Whether THIS handset has an OEM autostart / power manager to send the driver to.
   *
   * Asked of the device via Notifee rather than inferred from `family`, which is what the button
   * below used to be gated on. That gate was wrong in both directions: a Transsion or Huawei
   * phone that has such a screen was shown no button, and any phone in a listed family was shown
   * one whether or not the activity still existed. Undefined until the lookup returns, so the
   * button does not pop in after the screen has settled.
   */
  const [powerManager, setPowerManager] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void hasPowerManager().then((value) => {
      if (active) setPowerManager(value);
    });
    return () => {
      active = false;
    };
  }, []);

  /**
   * Set when the driver says they are done but Android still reports the app as optimised.
   *
   * Not a block — see `done()`. The driver is told once, and a second tap goes through.
   */
  const [unverified, setUnverified] = useState(false);

  const canGoBack = router.canGoBack();

  async function open(which: 'battery' | 'autostart' | 'fullscreen'): Promise<void> {
    setBusy(which);
    try {
      // Seeing the settings page counts as "seen" — the driver has been shown the door even if
      // they do not walk through it, so the forced redirect should not fire again.
      await markBatterySetupSeen();
      if (which === 'battery') await openBatterySettings();
      else if (which === 'autostart') await openAutostartSettings(family);
      else await openFullScreenIntentSettings();
    } finally {
      setBusy(null);
    }
  }

  /**
   * "I've set this up" — checked against the OS before it is believed.
   *
   * The whole screen used to take this on trust, which is how a driver who tapped it without
   * changing anything silenced the Home banner permanently and then quietly stopped receiving
   * work. Now the first tap verifies: if Android still reports the app as optimised, the driver
   * is told so and kept on the screen with the steps in front of them.
   *
   * A SECOND tap goes through regardless, and that matters — the read only covers the standard
   * AOSP setting, so a driver on a skin whose real restriction lives in an autostart list we
   * cannot query would otherwise be trapped on this screen for ever, insisting they had done it
   * and being told they had not. Being wrong once is recoverable; a dead end is not.
   */
  function done(): void {
    void (async () => {
      if (!unverified && (await isBatteryOptimisationActive())) {
        setUnverified(true);
        return;
      }
      await markBatterySetupConfirmed();
      leave();
    })();
  }

  function later(): void {
    void markBatterySetupSeen().then(() => leave());
  }

  function leave(): void {
    if (canGoBack) router.back();
    else router.replace('/home');
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {canGoBack ? (
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={22} color={colors.fg} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <Text style={styles.headerTitle}>Keep alerts working</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.leadIcon}>
          <Feather name="bell" size={26} color={colors.warning} />
        </View>

        <Text style={styles.title}>Your phone can silence trip offers</Text>
        <Text style={styles.lead}>
          On {guide.skinLabel} phones, the battery manager can stop DriverZone in the background —
          which means an offer that never rings. Two minutes of setup fixes it for good.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardHeading}>On your phone</Text>
          {guide.steps.map((step, index) => (
            <View key={step} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label="Open battery settings"
            onPress={() => void open('battery')}
            loading={busy === 'battery'}
            showArrow={false}
          />

          {powerManager === true ? (
            <Pressable
              onPress={() => void open('autostart')}
              disabled={busy !== null}
              accessibilityRole="button"
              style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            >
              <Feather name="rotate-cw" size={16} color={colors.fg} style={styles.secondaryIcon} />
              <Text style={styles.secondaryText}>Open autostart settings</Text>
            </Pressable>
          ) : null}

          {/*
            Android 14+ only. The offer is a full-screen "call" notification, and from API 34 that
            needs a permission the OS hands out to dialers and alarm clocks alone — every other app
            starts denied, and the ring then shows without waking the screen. There is no runtime
            prompt; this is the one settings screen that flips it.
          */}
          <Pressable
            onPress={() => void open('fullscreen')}
            disabled={busy !== null}
            accessibilityRole="button"
            style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
          >
            <Feather name="maximize" size={16} color={colors.fg} style={styles.secondaryIcon} />
            <Text style={styles.secondaryText}>Allow full-screen offer alerts</Text>
          </Pressable>
        </View>

        <Text style={styles.hint}>
          If a button opens the wrong screen, use the app’s Settings page — every phone has a
          Battery entry there.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {/*
          Shown only after a "done" that the OS disagreed with. It names what is still wrong and
          what the next tap will do, so carrying on is a choice rather than a way of dismissing a
          warning the driver did not understand.
        */}
        {unverified ? (
          <View style={styles.warning} accessibilityLiveRegion="polite">
            <Feather name="alert-triangle" size={16} color={colors.warning} />
            <Text style={styles.warningText}>
              Your phone still says DriverZone is battery optimised, so offers may not reach you.
              Check the steps above — or tap again to carry on anyway.
            </Text>
          </View>
        ) : null}

        <Pressable onPress={done} accessibilityRole="button" style={styles.doneButton}>
          <Feather name="check" size={18} color={colors.dutyOn} />
          <Text style={styles.doneText}>
            {unverified ? 'Carry on anyway' : 'I’ve set this up'}
          </Text>
        </Pressable>
        <Pressable onPress={later} accessibilityRole="button" style={styles.laterButton}>
          <Text style={styles.laterText}>Do this later</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSpacer: { width: 22 },

  scroll: { padding: space.lg, paddingBottom: space.xl },

  leadIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: '#FFF6E0',
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
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  stepNumberText: { color: colors.brandOnFg, fontSize: 12, fontWeight: '700' },
  stepText: { ...text.body, color: colors.fg, flex: 1 },

  actions: { marginTop: space.lg, gap: space.sm },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryPressed: { backgroundColor: colors.bgSunken },
  secondaryIcon: { marginRight: space.sm },
  secondaryText: { ...text.label, color: colors.fg },

  hint: { ...text.caption, color: colors.muted, marginTop: space.lg },

  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: '#FFF6E0',
    borderWidth: 1,
    borderColor: '#F0D9A0',
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
  },
  warningText: { ...text.caption, color: colors.fg, flex: 1 },

  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.dutyOn,
  },
  doneText: { ...text.heading, color: colors.dutyOn },
  laterButton: { alignItems: 'center', paddingVertical: space.md },
  laterText: { ...text.body, color: colors.muted },
});
