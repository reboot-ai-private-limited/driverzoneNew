import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SavedPlaceRow } from '@/components/SavedPlaceRow';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { getProfile } from '@/lib/api/endpoints/customer';
import * as session from '@/lib/auth/session';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * The account tab: who you are, what you have saved, and the way out.
 *
 * The mobile number comes from the PROFILE, not from the session. `session.ts` says why in its
 * own words: *"The refresh response carries no user."* — a restored session knows it is
 * authenticated and nothing more, so any screen that shows the number has to fetch it. The
 * session `user` is still the better source right after a fresh sign-in, so it stands in while
 * the profile query is in flight.
 */
export default function AccountScreen(): ReactElement {
  const { user } = session.getState();

  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

  const mobile = profile.data?.mobile_number ?? user?.mobile_number ?? null;
  const name = profile.data?.full_name ?? null;
  const savedAddresses = profile.data?.saved_addresses ?? [];

  async function handleSignOut(): Promise<void> {
    await session.signOut();
    router.replace('/phone');
  }

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Account</Text>

      <View style={styles.identity}>
        <View style={styles.avatar}>
          <Feather name="user" size={26} color={colors.fg} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.name}>{name ?? 'Your account'}</Text>
          {profile.isPending && mobile === null ? (
            <ActivityIndicator size="small" color={colors.muted} style={styles.spinner} />
          ) : (
            <Text style={styles.mobile}>
              {mobile === null ? 'Signed in' : formatForDisplay(mobile)}
            </Text>
          )}
        </View>
      </View>

      <Pressable
        onPress={() => router.push('/profile-setup')}
        accessibilityRole="button"
        style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
      >
        <Feather name="edit-2" size={18} color={colors.fg} />
        <Text style={styles.actionLabel}>Edit profile</Text>
        <Feather name="chevron-right" size={18} color={colors.faint} />
      </Pressable>

      <Text style={styles.sectionTitle}>Saved places</Text>
      {savedAddresses.length === 0 ? (
        <Text style={styles.emptyBody}>
          Save a place from the map and it will appear here for one-tap booking.
        </Text>
      ) : (
        savedAddresses.map((saved) => (
          // Read-only here: tapping a saved place on the BOOKING screen sets a destination, which
          // would be a non-sequitur from a settings list.
          <SavedPlaceRow
            key={saved.id}
            saved={saved}
            onPress={() => router.push('/home')}
            showPickupBadge
          />
        ))
      )}

      <Pressable
        onPress={() => void handleSignOut()}
        accessibilityRole="button"
        style={({ pressed }) => [styles.action, styles.signOut, pressed && styles.actionPressed]}
      >
        <Feather name="log-out" size={18} color={colors.danger} />
        <Text style={[styles.actionLabel, styles.danger]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  flex: { flex: 1 },
  danger: { color: colors.danger },

  title: { ...text.title, color: colors.fg, marginTop: space.lg, marginBottom: space.lg },

  identity: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...text.heading, color: colors.fg },
  mobile: { ...text.body, color: colors.muted, marginTop: 2 },
  spinner: { alignSelf: 'flex-start', marginTop: space.xs },

  sectionTitle: { ...text.label, color: colors.muted, marginTop: space.lg, marginBottom: space.sm },
  emptyBody: { ...text.body, color: colors.muted },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionPressed: { backgroundColor: colors.bgSunken },
  actionLabel: {
    ...text.body,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
    color: colors.fg,
    flex: 1,
  },
  signOut: { marginTop: space.lg },
});
