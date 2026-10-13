import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ComponentProps, type ReactElement, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { profileCompletionFromDto } from '@/features/profile/completion';
import { getProfile } from '@/lib/api/endpoints/customer';
import { stopPushRegistration } from '@/notifications/registerDevice';
import * as session from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

/**
 * The Profile tab — REAL identity and REAL saved-addresses count feeding a real completion bar;
 * everything below that is either a genuine link (Personal Information, Saved Addresses) or a
 * clearly-marked stand-in (`app/info/[topic].tsx` — see its own header for why those six rows
 * share one route rather than six).
 *
 * There is no profile photo field on `CustomerProfileDto`, so the avatar is a plain icon rather
 * than an invented picture — a fabricated face reads as a claim about a real person in a way a
 * generic glyph does not.
 */
export default function AccountScreen(): ReactElement {
  const { user } = session.getState();

  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

  const mobile = profile.data?.mobile_number ?? user?.mobile_number ?? null;
  const name = profile.data?.full_name ?? null;
  const completion = profile.data === undefined ? null : profileCompletionFromDto(profile.data);

  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    // Withdraw this handset from push BEFORE the session goes — the call is authenticated, and a
    // customer who signs out on a shared phone must stop getting the previous account's ride
    // updates. Done here rather than inside `session.signOut()` to keep `session.ts` free of an
    // import cycle through the API layer.
    await stopPushRegistration();
    await session.signOut();
    router.replace('/phone');
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => router.push('/info/notifications')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            style={styles.headerIcon}
          >
            <Feather name="bell" size={19} color={colors.fg} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/edit-profile')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            style={styles.headerIcon}
          >
            <Feather name="settings" size={19} color={colors.fg} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identityCard}>
          <View style={styles.identityRow}>
            <View style={styles.avatar}>
              <Feather name="user" size={26} color={colors.fg} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.name} numberOfLines={1}>
                {name ?? 'Your account'}
              </Text>
              {profile.isPending && mobile === null ? (
                <ActivityIndicator size="small" color={colors.muted} style={styles.spinner} />
              ) : (
                <View style={styles.mobileRow}>
                  <Feather name="phone" size={12} color={colors.muted} style={styles.mobileIcon} />
                  <Text style={styles.mobile}>
                    {mobile === null ? 'Signed in' : formatForDisplay(mobile)}
                  </Text>
                </View>
              )}
            </View>
          </View>

          {completion === null ? null : (
            <View style={styles.completionWrap}>
              <View style={styles.completionTopRow}>
                <Text style={styles.completionLabel}>Profile Completion</Text>
                <Text style={styles.completionValue}>{completion}%</Text>
              </View>
              <View style={styles.completionTrack}>
                <View style={[styles.completionFill, { width: `${completion}%` }]} />
              </View>
            </View>
          )}
        </View>

        <View style={styles.rowsCard}>
          <MenuRow
            icon="user"
            label="Personal Information"
            onPress={() => router.push('/edit-profile')}
          />
          <MenuRow
            icon="map-pin"
            label="Saved Addresses"
            onPress={() => router.push('/saved-addresses')}
          />
          {/* The cars the booking sheet offers under "Car number" — the driver drives the
              customer's own car, and the plate is how they find it. */}
          <MenuRow icon="truck" label="My Cars" onPress={() => router.push('/my-cars')} />
          {/* Beside the saved places rather than off with the informational rows below: both are
              lists the customer built themselves and both change what happens when they book. */}
          <MenuRow
            icon="heart"
            label="Favourite Drivers"
            onPress={() => router.push('/favourite-drivers')}
          />
          {/* Above the payment method on purpose: the wallet is what a trip is paid from FIRST,
              and the payment mode only settles whatever is left. */}
          <MenuRow icon="gift" label="Wallet" onPress={() => router.push('/wallet')} />
          <MenuRow
            icon="credit-card"
            label="Preferred Payment Method"
            onPress={() => router.push('/info/payment-method')}
          />
          <MenuRow
            icon="bell"
            label="Notifications"
            onPress={() => router.push('/info/notifications')}
          />
          {/* Above Help & Support deliberately: most of what people write in wants an answer
              this list already has, and the FAQs cost nobody a phone call. */}
          <MenuRow icon="book-open" label="FAQs" onPress={() => router.push('/info/faqs')} />
          <MenuRow
            icon="help-circle"
            label="Help & Support"
            onPress={() => router.push('/info/help')}
          />
          <MenuRow
            icon="shield"
            label="Privacy Policy"
            onPress={() => router.push('/info/privacy')}
          />
          <MenuRow
            icon="file-text"
            label="Terms & Conditions"
            onPress={() => router.push('/info/terms')}
          />
          <MenuRow
            icon="info"
            label="About DriverZone"
            onPress={() => router.push('/info/about')}
            last
          />
        </View>

        <Pressable
          onPress={() => setConfirmSignOut(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.logoutRow, pressed && styles.logoutRowPressed]}
        >
          <Feather name="log-out" size={18} color={colors.danger} />
          <Text style={styles.logoutLabel}>Logout</Text>
        </Pressable>

        {/* Quiet and last on purpose: required to be reachable (Google Play), not to be tapped by
            accident. The screen behind it explains everything and asks for a code first. */}
        <Pressable
          onPress={() => router.push('/delete-account')}
          accessibilityRole="button"
          hitSlop={8}
          style={styles.deleteRow}
        >
          <Text style={styles.deleteLabel}>Delete account</Text>
        </Pressable>
      </ScrollView>

      <BottomSheet
        visible={confirmSignOut}
        onClose={() => {
          if (!signingOut) setConfirmSignOut(false);
        }}
      >
        <View style={styles.logoutModal}>
          <View style={styles.logoutIcon}>
            <Feather name="log-out" size={26} color={colors.danger} />
          </View>
          <Text style={styles.logoutTitle}>Logout</Text>
          <Text style={styles.logoutBody}>Are you sure you want to logout?</Text>

          <View style={styles.logoutActions}>
            <Pressable
              onPress={() => setConfirmSignOut(false)}
              accessibilityRole="button"
              disabled={signingOut}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
            >
              <Text style={styles.cancelButtonLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => void handleSignOut()}
              accessibilityRole="button"
              disabled={signingOut}
              style={({ pressed }) => [
                styles.confirmLogoutButton,
                pressed && styles.confirmLogoutButtonPressed,
              ]}
            >
              {signingOut ? (
                <ActivityIndicator size="small" color={colors.brand} />
              ) : (
                <Text style={styles.confirmLogoutLabel}>Logout</Text>
              )}
            </Pressable>
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  last = false,
}: {
  icon: FeatherName;
  label: string;
  onPress: () => void;
  last?: boolean;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.menuRow,
        last && styles.menuRowLast,
        pressed && styles.menuRowPressed,
      ]}
    >
      <View style={styles.menuIcon}>
        <Feather name={icon} size={16} color={colors.fg} />
      </View>
      <Text style={styles.menuLabel}>{label}</Text>
      <Feather name="chevron-right" size={17} color={colors.faint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  title: { ...text.title, color: colors.fg },
  headerActions: { flexDirection: 'row', gap: space.sm },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },

  content: { padding: space.lg, paddingBottom: space.xl },

  identityCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.md,
    ...shadow.soft,
  },
  identityRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  name: { ...text.heading, color: colors.fg },
  mobileRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  mobileIcon: { marginRight: 4 },
  mobile: { ...text.body, color: colors.muted },
  spinner: { alignSelf: 'flex-start', marginTop: space.xs },

  completionWrap: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  completionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  completionLabel: { ...text.caption, color: colors.muted },
  completionValue: { ...text.caption, color: colors.fg, fontFamily: fontFamily.bold },
  completionTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgSunken,
    overflow: 'hidden',
  },
  completionFill: { height: 6, borderRadius: 3, backgroundColor: colors.brand },

  rowsCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    marginBottom: space.md,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  menuRowLast: { borderBottomWidth: 0 },
  menuRowPressed: { backgroundColor: colors.bgSunken },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuLabel: { ...text.body, color: colors.fg, flex: 1 },

  logoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  logoutRowPressed: { backgroundColor: colors.bgSunken },
  logoutLabel: { ...text.body, color: colors.danger, fontFamily: fontFamily.semibold },
  deleteRow: { alignItems: 'center', paddingVertical: space.md, marginTop: space.sm },
  deleteLabel: { ...text.caption, color: colors.muted, textDecorationLine: 'underline' },

  logoutModal: { alignItems: 'center' },
  logoutIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  logoutTitle: { ...text.heading, color: colors.fg },
  logoutBody: { ...text.body, color: colors.muted, marginTop: space.xs, marginBottom: space.lg },
  logoutActions: { flexDirection: 'row', gap: space.sm, alignSelf: 'stretch' },
  cancelButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonPressed: { backgroundColor: colors.bgSunken },
  cancelButtonLabel: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  confirmLogoutButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLogoutButtonPressed: { opacity: 0.88 },
  confirmLogoutLabel: { ...text.body, color: colors.brand, fontFamily: fontFamily.bold },
});
