import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useQuery } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { StatusPill } from '@/components/StatusPill';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { getProfile } from '@/lib/api/endpoints/driver';
import * as session from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * The Account tab — identity, verification state, the driver-ops shortcuts, the app rows, and
 * the way out.
 *
 * Shaped to match `apps/customer/app/(tabs)/account.tsx`: the same two-group layout, the same
 * legal/help/about rows behind a single `info/[topic]` stand-in, and an in-app confirm sheet for
 * sign-out rather than a native `Alert` — the two apps should feel like one product.
 *
 * Verification is shown here as well as in onboarding on purpose: an approved driver can still
 * have one rejected document (`user.md` — per-document review is independent of the overall
 * approval), and this is the only screen they visit once they are past onboarding.
 */
export default function AccountScreen(): ReactElement {
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });

  function handleSignOut(): void {
    setSigningOut(true);
    // `signOut` clears this device even if the server call fails — a driver who taps sign out is
    // signed out, whatever the network did.
    void session.signOut().then(() => router.replace('/phone'));
  }

  if (profile.isPending) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.fg} />
      </View>
    );
  }

  const data = profile.data;

  return (
    <>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Account</Text>
        </View>

        <View style={styles.body}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Feather name="user" size={26} color={colors.muted} />
            </View>
            <View style={styles.identityText}>
              <Text style={styles.name}>{data?.full_name ?? 'Your profile'}</Text>
              <Text style={styles.phone}>
                {data === undefined ? '' : formatForDisplay(data.mobile_number)}
              </Text>
            </View>
          </View>

          {data !== undefined ? (
            <View style={styles.statusRow}>
              <StatusPill
                label={
                  data.is_verified ? 'Verified driver' : ONBOARDING_LABELS[data.onboarding_status]
                }
                tone={data.is_verified ? 'success' : ONBOARDING_TONES[data.onboarding_status]}
              />
              {data.can_drive_hill_verified ? (
                <StatusPill label="Hill approved" tone="success" />
              ) : null}
            </View>
          ) : null}

          <View style={styles.group}>
            <Row icon="user" label="Your details" onPress={() => router.push('/onboarding-profile')} />
            <Row
              icon="file-text"
              label="Your documents"
              onPress={() => router.push('/onboarding-documents')}
            />
            {/* Reachable again after the one-time run from `/gate` — a driver who skipped it, or
                changed phones, needs a way back to it. */}
            <Row
              icon="bell"
              label="Alert & battery setup"
              onPress={() => router.push('/battery-setup')}
            />
          </View>

          {/* The app rows. Every destination is the `info/[topic]` stand-in until it has an API
              behind it — same as the customer app. */}
          <View style={styles.group}>
            <Row
              icon="bell"
              label="Notifications"
              onPress={() => router.push('/info/notifications')}
            />
            {/* The one row here with a real API behind it. Above Help & Support deliberately:
                what a customer owes for food and stay is answered in the list, not by a call. */}
            <Row icon="book-open" label="FAQs" onPress={() => router.push('/info/faqs')} />
            <Row
              icon="help-circle"
              label="Help & Support"
              onPress={() => router.push('/info/help')}
            />
            <Row
              icon="shield"
              label="Privacy Policy"
              onPress={() => router.push('/info/privacy')}
            />
            <Row
              icon="file-text"
              label="Terms & Conditions"
              onPress={() => router.push('/info/terms')}
            />
            <Row
              icon="info"
              label="About DriverZone"
              onPress={() => router.push('/info/about')}
            />
          </View>

          <View style={styles.group}>
            <Row
              icon="log-out"
              label="Sign out"
              tone="danger"
              busy={signingOut}
              onPress={() => setConfirmSignOut(true)}
            />
          </View>

          <Text style={styles.version}>
            DriverZone Driver · v{Constants.expoConfig?.version ?? '0.1.0'}
          </Text>
        </View>
      </ScrollView>

      {/*
        An in-app confirm rather than `Alert.alert`, matching the customer app. A native dialog on
        the one destructive action in the app is jarring against every other confirmation being a
        sheet — and it cannot show a spinner while the sign-out request is in flight.
      */}
      <BottomSheet visible={confirmSignOut} onClose={() => setConfirmSignOut(false)}>
        <View style={styles.sheetIcon}>
          <Feather name="log-out" size={24} color={colors.danger} />
        </View>
        <Text style={styles.sheetTitle}>Sign out?</Text>
        <Text style={styles.sheetBody}>
          You will need your mobile number and an OTP to sign back in.
        </Text>

        <View style={styles.sheetActions}>
          <PrimaryButton
            label="Sign out"
            onPress={handleSignOut}
            loading={signingOut}
            showArrow={false}
          />
          <Pressable
            onPress={() => setConfirmSignOut(false)}
            disabled={signingOut}
            accessibilityRole="button"
            style={styles.sheetCancel}
          >
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </BottomSheet>
    </>
  );
}

const ONBOARDING_LABELS = {
  INCOMPLETE: 'Setup incomplete',
  SUBMITTED: 'Under review',
  APPROVED: 'Approved',
  REJECTED: 'Needs changes',
} as const;

const ONBOARDING_TONES = {
  INCOMPLETE: 'pending',
  SUBMITTED: 'pending',
  APPROVED: 'success',
  REJECTED: 'danger',
} as const;

function Row({
  icon,
  label,
  onPress,
  tone = 'default',
  busy = false,
}: {
  icon: FeatherName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  busy?: boolean;
}): ReactElement {
  const colour = tone === 'danger' ? colors.danger : colors.fg;

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Feather name={icon} size={18} color={colour} style={styles.rowIcon} />
      <Text style={[styles.rowLabel, { color: colour }]}>{label}</Text>
      {busy ? (
        <ActivityIndicator size="small" color={colour} />
      ) : (
        <Feather name="chevron-right" size={18} color={colors.faint} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { backgroundColor: colors.brand, paddingHorizontal: space.lg, paddingVertical: space.lg },
  headerTitle: { ...text.title, color: colors.fg },
  body: { padding: space.lg },

  identity: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityText: { marginLeft: space.md, flex: 1 },
  name: { ...text.heading, color: colors.fg },
  phone: { ...text.body, color: colors.muted, marginTop: 2 },

  statusRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md, flexWrap: 'wrap' },

  group: {
    marginTop: space.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', padding: space.md },
  rowPressed: { backgroundColor: colors.bgSunken },
  rowIcon: { marginRight: space.md },
  rowLabel: { ...text.body, flex: 1 },

  version: { ...text.caption, color: colors.faint, textAlign: 'center', marginTop: space.xl },

  sheetIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: '#FDEDEE',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: space.md,
  },
  sheetTitle: { ...text.heading, color: colors.fg, textAlign: 'center' },
  sheetBody: {
    ...text.body,
    color: colors.muted,
    textAlign: 'center',
    marginTop: space.xs,
    marginBottom: space.lg,
  },
  sheetActions: { gap: space.sm },
  sheetCancel: { alignItems: 'center', paddingVertical: space.md },
  sheetCancelText: { ...text.body, color: colors.muted },
});
