import { Feather } from '@expo/vector-icons';
import type { BookingDto } from '@driverzone/contracts';
import { type ReactElement, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { FavouriteHeart } from '@/components/FavouriteHeart';
import { formatForDisplay } from '@/features/auth/phoneNumber';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

type Driver = NonNullable<BookingDto['driver']>;

/**
 * WHO IS DRIVING — photo, name, rating, and a way to reach them.
 *
 * This is the card the trip screen's own header once said was "a real thing to build once the
 * identity module has something behind it to show". It has: drivers upload an avatar to a public
 * bucket precisely so a customer can see who is coming, and `reviews` keeps a rolling average on
 * the account.
 *
 * **The call button appears only when the server sent a number**, which it does only while the
 * trip is live (`PHONE_VISIBLE_STATUSES` in the API's booking mapper). This component does not
 * decide that and must not try: a screen that hid a number it had been given would still be
 * holding it in a cached response. `phone === null` is the whole rule here — no status checks.
 *
 * **Nothing is invented.** No photo means initials, not a stock silhouette; no rating means the
 * row is absent, not "★ —" or a default five stars. Every one of those was a real field on the
 * demo data this app used to carry, and each one that had no honest source was deleted rather
 * than filled in.
 */
export function DriverCard({
  driver,
  /**
   * Show the heart that adds this driver to the customer's favourites.
   *
   * A PROP RATHER THAN SOMETHING THIS CARD WORKS OUT, and false by default, because the rule
   * behind it is the caller's to know: the API only accepts a driver the customer has COMPLETED a
   * trip with. A heart on a trip still in progress would be a button that always failed.
   */
  favouritable = false,
}: {
  driver: Driver;
  favouritable?: boolean;
}): ReactElement {
  const [photoFailed, setPhotoFailed] = useState(false);
  const name = driver.name ?? 'Your driver';
  const showPhoto = driver.photo_url !== null && !photoFailed;

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.avatar}>
          {showPhoto ? (
            <Image
              source={{ uri: driver.photo_url ?? '' }}
              style={styles.photo}
              resizeMode="cover"
              // A public URL can still 404 — a deleted object, a bucket moved. Falling back to
              // initials keeps the card intact instead of leaving a grey hole in it.
              onError={() => setPhotoFailed(true)}
              accessibilityLabel={`Photo of ${name}`}
            />
          ) : (
            <Text style={styles.initials}>{initialsOf(driver.name)}</Text>
          )}
        </View>

        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>

          {/* Only once somebody has actually rated them — the account row defaults to 5.0, and
              showing that unearned would flatter every new driver identically. */}
          {driver.rating === null ? (
            <Text style={styles.sub}>Your driver</Text>
          ) : (
            <View style={styles.ratingRow}>
              {/* Ink, not the brand yellow: yellow is a SURFACE here (~1.1:1 on white) and a
                  yellow star on a white card is a star nobody can see. */}
              <Feather name="star" size={13} color={colors.fg} />
              <Text style={styles.rating}>{driver.rating.toFixed(1)}</Text>
              <Text style={styles.ratingCount}>
                ({driver.rating_count} {driver.rating_count === 1 ? 'rating' : 'ratings'})
              </Text>
            </View>
          )}

          {driver.phone === null ? null : (
            <Text style={styles.phone} selectable>
              {formatForDisplay(driver.phone)}
            </Text>
          )}
        </View>

        {/*
          The call button sits beside the identity rather than under it, so the tap target is
          exactly where a thumb already is when the customer has decided to ring.
        */}
        {favouritable ? <FavouriteHeart driverId={driver.id} /> : null}

        {driver.phone === null ? null : (
          <Pressable
            onPress={() => {
              void Linking.openURL(`tel:${driver.phone ?? ''}`);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Call ${name}`}
            hitSlop={8}
            style={({ pressed }) => [styles.callButton, pressed && styles.callButtonPressed]}
          >
            <Feather name="phone" size={20} color={colors.fg} />
          </Pressable>
        )}
      </View>

      {driver.phone === null ? null : (
        <Text style={styles.hint}>
          Call your driver if you cannot find each other at the pickup.
        </Text>
      )}
    </View>
  );
}

/** Two letters at most — the fallback when there is no photo, never a stock silhouette. */
function initialsOf(name: string | null): string {
  if (name === null) return '?';
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },

  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
    overflow: 'hidden',
  },
  photo: { width: '100%', height: '100%' },
  initials: { ...text.heading, color: colors.fg },

  name: { ...text.body, color: colors.fg, fontFamily: fontFamily.bold },
  sub: { ...text.caption, color: colors.muted, marginTop: 1 },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  rating: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },
  ratingCount: { ...text.caption, color: colors.faint },

  phone: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold, marginTop: 4 },

  callButton: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    borderWidth: 1,
    borderColor: colors.fg,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: space.sm,
  },
  callButtonPressed: { opacity: 0.85 },

  hint: { ...text.caption, color: colors.faint, marginTop: space.sm },
});
