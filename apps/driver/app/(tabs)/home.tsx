import { Feather } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusPill } from '@/components/StatusPill';
import { Logo } from '@/components/Logo';
import { getProfile } from '@/lib/api/endpoints/driver';
import { keys } from '@/lib/query/keys';
import { colors, radius, shadow, space, text } from '@/theme/theme';

/**
 * The duty screen — where an approved driver spends every shift.
 *
 * **The toggle is local state and nothing else, for now.** `POST /driver/duty` does not exist
 * yet (the API is at Phase 1 — zones and identity), and neither does the Android foreground
 * service, the socket, or the location pings that a real duty toggle has to start and stop
 * (docs/LLD/driver-app.md S-8).
 *
 * Building the screen ahead of them is deliberate rather than premature: the layout, the states
 * and the copy are what the offer system will land into, and having them settled means that work
 * is only the hard part. Every place a real call belongs is marked TODO(S-8) below so none of
 * them is discovered by accident later.
 */
export default function HomeScreen(): ReactElement {
  /**
   * TODO(S-8): replace with server state.
   *
   * Duty is NOT a client opinion — dispatch reads `is_on_duty` off the driver record, so the
   * server is the only thing that can say. When `POST /driver/duty` lands this becomes a
   * mutation plus the profile's own flag, and this `useState` goes away entirely. It is here so
   * the screen can be looked at, not because a local boolean is a reasonable model of duty.
   */
  const [onDuty, setOnDuty] = useState(false);

  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });

  const firstName = profile.data?.full_name?.trim().split(' ')[0] ?? 'there';

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Logo width={140} />
        <StatusPill
          label={onDuty ? 'Online' : 'Offline'}
          tone={onDuty ? 'success' : 'neutral'}
          icon={onDuty ? 'wifi' : 'wifi-off'}
        />
      </View>

      <View style={styles.body}>
        <Text style={styles.greeting}>Hello, {firstName}</Text>
        <Text style={styles.greetingSub}>
          {onDuty ? 'You are online. Trip offers will ring on this phone.' : 'Go online to start receiving trips.'}
        </Text>

        {/* The duty card. One control, deliberately the largest thing on the screen — it is the
            only decision a driver makes between trips. */}
        <View style={[styles.dutyCard, onDuty ? styles.dutyCardOn : styles.dutyCardOff]}>
          <View style={styles.dutyIcon}>
            <Feather
              name={onDuty ? 'radio' : 'power'}
              size={30}
              color={onDuty ? colors.dutyOn : colors.dutyOff}
            />
          </View>

          <Text style={styles.dutyTitle}>{onDuty ? "You're on duty" : "You're off duty"}</Text>
          <Text style={styles.dutyBody}>
            {onDuty
              ? 'Keep the app installed and battery optimisation off so offers reach you.'
              : 'Dispatch only offers trips to drivers who are on duty.'}
          </Text>

          <Pressable
            // TODO(S-8): POST /driver/duty { on_duty }, then start/stop the foreground service,
            // the socket connection and location pings in that order. A 409 here means not yet
            // approved, documents expired, or wallet blocked — render its `message` verbatim.
            onPress={() => setOnDuty((current) => !current)}
            accessibilityRole="switch"
            accessibilityState={{ checked: onDuty }}
            style={({ pressed }) => [
              styles.dutyButton,
              onDuty ? styles.dutyButtonOn : styles.dutyButtonOff,
              pressed && styles.dutyButtonPressed,
            ]}
          >
            <Text style={[styles.dutyButtonText, onDuty && styles.dutyButtonTextOn]}>
              {onDuty ? 'Go off duty' : 'Go on duty'}
            </Text>
          </Pressable>
        </View>

        {/*
          An honest placeholder, not a fake dashboard. Inventing "0 trips · ₹0" would look like
          real data on a driver's first morning and quietly train them to distrust the numbers.
        */}
        <View style={styles.notice}>
          <Feather name="info" size={16} color={colors.muted} />
          <Text style={styles.noticeText}>
            Trip offers, navigation and earnings arrive in the next release. Your account is set up
            and ready.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, backgroundColor: colors.bg },

  header: {
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  body: { padding: space.lg },

  greeting: { ...text.title, color: colors.fg },
  greetingSub: { ...text.body, color: colors.muted, marginTop: space.xs, marginBottom: space.xl },

  dutyCard: {
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    borderWidth: 1,
    ...shadow.card,
  },
  dutyCardOn: { backgroundColor: colors.dutyOnBg, borderColor: colors.dutyOn },
  dutyCardOff: { backgroundColor: colors.card, borderColor: colors.border },
  dutyIcon: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  dutyTitle: { ...text.heading, color: colors.fg },
  dutyBody: { ...text.body, color: colors.muted, textAlign: 'center', marginTop: space.xs },

  dutyButton: {
    marginTop: space.lg,
    height: 54,
    minWidth: 220,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  dutyButtonOff: { backgroundColor: colors.fg },
  dutyButtonOn: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.dutyOn },
  dutyButtonPressed: { opacity: 0.85 },
  dutyButtonText: { ...text.heading, color: colors.brandOnFg },
  dutyButtonTextOn: { color: colors.dutyOn },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.xl,
  },
  noticeText: { ...text.caption, color: colors.muted, flex: 1 },
});
