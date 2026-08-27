import type { ReactElement } from 'react';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useSession } from '@/lib/auth/SessionProvider';
import * as session from '@/lib/auth/session';
import { colors, space, text } from '@/theme/theme';

/**
 * PLACEHOLDER — the signed-in landing, so the login flow has somewhere to end.
 *
 * The real home screen is the coverage pre-check plus pickup entry, and it needs
 * `GET /coverage/check` (which exists) and a map (which needs `expo-location` and a maps
 * module). It is deliberately not sketched here: guessing at a screen whose design has not been
 * approved produces code that has to be deleted rather than edited.
 *
 * Sign out is real, so the auth flow can be exercised end to end without reinstalling.
 */
export default function HomeScreen(): ReactElement {
  const { user } = useSession();

  async function handleSignOut(): Promise<void> {
    await session.signOut();
    router.replace('/phone');
  }

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Text style={styles.title}>You are signed in</Text>
        <Text style={styles.body}>
          {user?.mobile_number ?? 'Session restored from the device keystore.'}
        </Text>
        <Text style={styles.note}>
          The booking flow lands in phase 7 — see docs/LLD/roadmap.md.
        </Text>
      </View>

      <PrimaryButton label="Sign out" onPress={() => void handleSignOut()} showArrow={false} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { ...text.title, color: colors.fg },
  body: { ...text.body, color: colors.muted, marginTop: space.sm },
  note: { ...text.caption, color: colors.faint, marginTop: space.lg, textAlign: 'center' },
});
