import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { FavouriteDriverDto } from '@driverzone/contracts';
import { useFavouriteDrivers } from '@/features/favourites/useFavouriteDrivers';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * MANAGE THE DRIVERS THIS CUSTOMER WANTS RUNG FIRST.
 *
 * READ AND REMOVE ONLY, and deliberately so — the same shape as `saved-addresses.tsx`. A driver
 * becomes a favourite at the end of a trip with them, which is the only place the customer has
 * ever seen who that driver is; an "add" here would have to be a searchable directory of every
 * driver on the platform, which is not a thing a customer should be handed.
 *
 * The hint at the bottom says where adding actually happens rather than pretending this screen
 * can do it.
 */
export default function FavouriteDriversScreen(): ReactElement {
  const { favourites, max, loading, toggle, saving, error } = useFavouriteDrivers();
  /** Which row's remove button was pressed, so only that row shows the spinner. */
  const [removing, setRemoving] = useState<string | null>(null);

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
        <Text style={styles.headerTitle}>Favourite Drivers</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/*
          A REMOVE THAT FAILED HAS TO SAY SO. Without this the row simply stays put, which looks
          exactly like not having tapped it — so the customer taps again, and neither attempt gives
          any feedback but a spinner that stops.
        */}
        {error !== null ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error.message}
          </Text>
        ) : null}

        {loading ? (
          <ActivityIndicator size="large" color={colors.muted} style={styles.loading} />
        ) : favourites.length === 0 ? (
          <Text style={styles.emptyBody}>
            No favourite drivers yet. After a trip, tap the heart on your driver to add them here.
          </Text>
        ) : (
          <>
            <Text style={styles.intro}>
              These drivers are offered your booking first whenever you ask for them. If none of
              them takes it, we look for everyone else straight away — you are never left waiting.
            </Text>

            {favourites.map((driver) => (
              <DriverRow
                key={driver.id}
                driver={driver}
                removing={saving && removing === driver.id}
                onRemove={() => {
                  setRemoving(driver.id);
                  toggle(driver.id);
                }}
              />
            ))}

            <Text style={styles.count}>
              {favourites.length} of {max} saved
            </Text>
          </>
        )}

        <View style={styles.hint}>
          <Feather name="heart" size={14} color={colors.muted} style={styles.hintIcon} />
          <Text style={styles.hintText}>
            Turn on &ldquo;Ring my favourite drivers first&rdquo; when you book to use this list.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

/** One saved driver. Nothing is invented: no photo means initials, no rating means no row. */
function DriverRow({
  driver,
  removing,
  onRemove,
}: {
  driver: FavouriteDriverDto;
  removing: boolean;
  onRemove: () => void;
}): ReactElement {
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = driver.name ?? 'Your driver';
  const showPhoto = driver.photo_url !== null && !photoFailed;

  return (
    <View style={styles.row}>
      <View style={styles.avatar}>
        {showPhoto ? (
          <Image
            source={{ uri: driver.photo_url ?? '' }}
            style={styles.photo}
            resizeMode="cover"
            onError={() => setPhotoFailed(true)}
            accessibilityLabel={`Photo of ${name}`}
          />
        ) : (
          <Text style={styles.initials}>{initialsOf(driver.name)}</Text>
        )}
      </View>

      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {/* Only once somebody has actually rated them — the account row defaults to 5.0, and
            showing that unearned would flatter every new driver identically. */}
        {driver.rating === null ? null : (
          <View style={styles.ratingRow}>
            <Feather name="star" size={12} color={colors.fg} />
            <Text style={styles.rating}>{driver.rating.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>
              ({driver.rating_count} {driver.rating_count === 1 ? 'rating' : 'ratings'})
            </Text>
          </View>
        )}
      </View>

      <Pressable
        onPress={onRemove}
        disabled={removing}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${name} from favourites`}
        style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
      >
        {removing ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <Feather name="x" size={18} color={colors.muted} />
        )}
      </Pressable>
    </View>
  );
}

/** Two letters at most — the fallback when there is no photo, never a stock silhouette. */
function initialsOf(name: string | null): string {
  if (name === null) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
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
  loading: { marginTop: space.xl },
  intro: { ...text.caption, color: colors.muted, marginBottom: space.md },
  emptyBody: { ...text.body, color: colors.muted },
  error: { ...text.caption, color: colors.danger, marginBottom: space.sm },
  count: { ...text.caption, color: colors.faint, marginTop: space.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    marginRight: space.md,
  },
  photo: { width: '100%', height: '100%' },
  initials: { ...text.body, color: colors.fg, fontFamily: fontFamily.bold },
  rowText: { flex: 1 },
  name: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rating: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },
  ratingCount: { ...text.caption, color: colors.muted },
  remove: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  removePressed: { opacity: 0.5 },

  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.lg,
  },
  hintIcon: { marginRight: space.sm, marginTop: 1 },
  hintText: { ...text.caption, color: colors.muted, flex: 1 },
});
