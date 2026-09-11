import { Feather } from '@expo/vector-icons';
import { type ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFavouriteDrivers } from '@/features/favourites/useFavouriteDrivers';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * ADD OR REMOVE ONE DRIVER FROM THE CUSTOMER'S FAVOURITES.
 *
 * The same component wherever a finished trip's driver is on screen — the rating screen, the live
 * trip card, a past ride, the manage page. It owns no state of its own: filled or empty comes from
 * `useFavouriteDrivers`, which every instance shares, so tapping one fills the rest.
 *
 * **It is only ever rendered where a completed trip is behind it.** The server refuses a driver
 * this customer has never ridden with, and that rule is the reason the endpoint is not an oracle
 * for arbitrary driver ids — so the screens do not put a heart anywhere it could be tapped
 * pointlessly.
 *
 * **Nothing is optimistic.** Adding can legitimately fail — the cap, or a driver removed from the
 * platform — and a heart that fills and then quietly empties again is worse than one that takes a
 * moment. It shows a spinner instead, and says why when the server refuses.
 */
export function FavouriteHeart({
  driverId,
  /** Renders the word beside the icon. For a full-width row; off for a tight card corner. */
  withLabel = false,
}: {
  driverId: string;
  withLabel?: boolean;
}): ReactElement {
  const { isFavourite, isFull, toggle, saving, error } = useFavouriteDrivers();

  const on = isFavourite(driverId);
  // Full only blocks ADDING. Removing must always work, or a customer at the cap is stuck at it.
  const blocked = isFull && !on;

  return (
    <View style={withLabel ? styles.block : undefined}>
      <Pressable
        onPress={() => {
          if (!saving && !blocked) toggle(driverId);
        }}
        disabled={saving || blocked}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityState={{ selected: on, disabled: saving || blocked }}
        accessibilityLabel={on ? 'Remove from favourite drivers' : 'Add to favourite drivers'}
        style={({ pressed }) => [
          styles.button,
          withLabel && styles.buttonWide,
          on && styles.buttonOn,
          (pressed || saving) && styles.pressed,
          blocked && styles.blocked,
        ]}
      >
        {saving ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <Feather
            name="heart"
            size={17}
            color={on ? colors.danger : colors.muted}
            // `Feather` has no filled heart, so the filled state is carried by the tinted pill
            // behind it plus the colour — not by a second icon that would sit differently.
          />
        )}

        {withLabel ? (
          <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
            {on ? 'Favourite driver' : 'Add to favourites'}
          </Text>
        ) : null}
      </Pressable>

      {/* Only ever the reason the tap did not take. A silent no-op here reads as a broken button. */}
      {withLabel && blocked ? (
        <Text style={styles.hint}>You have reached your favourite drivers limit.</Text>
      ) : null}
      {withLabel && error !== null ? <Text style={styles.hint}>{error.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.xs },
  button: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  buttonWide: { width: 'auto', paddingHorizontal: space.md, alignSelf: 'flex-start' },
  buttonOn: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  pressed: { opacity: 0.6 },
  blocked: { opacity: 0.45 },
  label: { ...text.label, color: colors.muted, fontFamily: fontFamily.semibold },
  labelOn: { color: colors.danger },
  hint: { ...text.caption, color: colors.muted },
});
