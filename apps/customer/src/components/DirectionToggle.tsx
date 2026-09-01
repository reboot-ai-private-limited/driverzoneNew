import type { ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Direction } from '@driverzone/contracts';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface DirectionToggleProps {
  value: Direction;
  onChange: (direction: Direction) => void;
  /** Locked while a price is in flight — see the note on why this is not merely cosmetic. */
  disabled?: boolean;
}

const OPTIONS: ReadonlyArray<{ value: Direction; label: string; hint: string }> = [
  { value: 'ONE_WAY', label: 'One way', hint: 'Dropped off and done' },
  { value: 'ROUND_TRIP', label: 'Round trip', hint: 'Driver waits and brings you back' },
];

/**
 * OUTSTATION ONLY, and the caller is responsible for that — this renders whenever it is mounted.
 *
 * The direction is not a filter over one price; it selects a DIFFERENT PRODUCT with its own fare.
 * A round trip is never a doubled one-way: the driver waits at the destination, may get no return
 * fare, and may be away overnight, so the band carries a separate `round_trip_fare_paise` that
 * covers the whole journey however many days it runs (`packages.ts`). Switching therefore re-asks
 * the server rather than recomputing anything here.
 *
 * A band may not sell a return at all — `round_trip_fare_paise` is null — in which case the quote
 * comes back `available: false` with a reason, and the screen's unavailable notice explains it.
 * That is deliberately NOT pre-empted by hiding the option: the app cannot know which bands sell
 * returns without asking, and a control that silently vanishes for some destinations is harder to
 * understand than one that answers honestly.
 */
export function DirectionToggle({
  value,
  onChange,
  disabled = false,
}: DirectionToggleProps): ReactElement {
  return (
    <View style={styles.root} accessibilityRole="radiogroup">
      {OPTIONS.map((option) => {
        const active = option.value === value;

        return (
          <Pressable
            key={option.value}
            onPress={() => {
              // Re-selecting the current direction would re-render for nothing; more to the
              // point, with a query key already in flight it reads as a second request.
              if (!active) onChange(option.value);
            }}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={`${option.label}. ${option.hint}.`}
            style={({ pressed }) => [
              styles.option,
              active && styles.optionActive,
              pressed && !active && styles.pressed,
              disabled && styles.disabled,
            ]}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {option.label}
            </Text>
            <Text style={[styles.hint, active && styles.hintActive]} numberOfLines={1}>
              {option.hint}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    marginBottom: space.md,
  },
  option: {
    flex: 1,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    alignItems: 'center',
  },
  // Ink fill for the selected half, matching `PrimaryButton`: yellow is a surface in this palette
  // and would not read as selected against the sunken grey behind it.
  optionActive: { backgroundColor: colors.fg },
  pressed: { opacity: 0.7 },
  // The whole control dims rather than the pressed half, so "busy" never looks like "chosen".
  disabled: { opacity: 0.5 },

  label: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },
  labelActive: { color: colors.brandOnFg, fontFamily: fontFamily.bold },
  hint: { ...text.caption, color: colors.muted, marginTop: 1 },
  hintActive: { color: colors.onFg, opacity: 0.8 },
});
