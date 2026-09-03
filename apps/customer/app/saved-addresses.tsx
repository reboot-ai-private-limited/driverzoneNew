import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SavedAddressDto } from '@driverzone/contracts';
import { SavedPlaceRow } from '@/components/SavedPlaceRow';
import { getProfile, removeAddress } from '@/lib/api/endpoints/customer';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

/**
 * The account tab's own saved-places screen — REAL, unlike its two neighbours in this batch.
 * `GET /customer/profile` and `DELETE /customer/addresses/:id` both already exist and are already
 * used elsewhere (`home.tsx`'s address picker); this is the same data, read-and-delete only.
 *
 * NO "ADD" HERE. Adding a place means dropping a pin on the map, and that map lives on `home.tsx`
 * — duplicating a picker here would be a second, worse version of the one that already works. The
 * hint at the bottom points there instead of pretending this screen can do it.
 */
export default function SavedAddressesScreen(): ReactElement {
  const queryClient = useQueryClient();

  const profile = useQuery({
    queryKey: keys.profile.me(),
    queryFn: getProfile,
  });

  const forget = useMutation({
    mutationFn: (saved: SavedAddressDto) => removeAddress(saved.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.profile.all() }),
  });

  const addresses = profile.data?.saved_addresses ?? [];

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
        <Text style={styles.headerTitle}>Saved Addresses</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/*
          A DELETE THAT FAILED HAS TO SAY SO. Without this the row simply stays put — which looks
          identical to not having tapped it, so the customer taps again, and the only feedback
          either attempt gives is a spinner that stops.
        */}
        {forget.isError ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {forget.error instanceof Error
              ? forget.error.message
              : 'We could not remove that address.'}
          </Text>
        ) : null}

        {addresses.length === 0 ? (
          <Text style={styles.emptyBody}>
            Nothing saved yet. Save a place from the map and it will show up here.
          </Text>
        ) : (
          addresses.map((saved) => (
            <SavedPlaceRow
              key={saved.id}
              saved={saved}
              onPress={() => undefined}
              showPickupBadge
              onRemove={(target) => forget.mutate(target)}
              removing={forget.isPending && forget.variables?.id === saved.id}
            />
          ))
        )}

        <View style={styles.hint}>
          <Feather name="map-pin" size={14} color={colors.muted} style={styles.hintIcon} />
          <Text style={styles.hintText}>
            To save a new place, drop a pin for it from the home screen&apos;s pickup or destination
            picker.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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

  content: { padding: space.lg },
  emptyBody: { ...text.body, color: colors.muted },
  error: { ...text.caption, color: colors.danger, marginBottom: space.sm },

  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
  hintIcon: { marginRight: space.sm, marginTop: 1 },
  hintText: { ...text.caption, color: colors.muted, flex: 1 },
});
