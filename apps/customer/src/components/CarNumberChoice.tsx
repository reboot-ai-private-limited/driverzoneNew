import type { VehicleDto } from '@driverzone/contracts';
import * as Haptics from 'expo-haptics';
import { type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/** One of the customer's saved cars, or a number typed now (saved to their profile on booking). */
export type CarNumberSelection = { kind: 'saved'; id: string } | { kind: 'new'; plate: string };

/** The server's own rule (`identity.validation.ts`): 4–16 characters once trimmed. */
export function isPlateValid(plate: string): boolean {
  const trimmed = plate.trim();
  return trimmed.length >= 4 && trimmed.length <= 16;
}

/** Ready to book with: a saved car, or a typed number that passes the rule. */
export function isCarNumberReady(selection: CarNumberSelection | null): boolean {
  if (selection === null) return false;
  return selection.kind === 'saved' || isPlateValid(selection.plate);
}

/**
 * The starting answer: the customer's default car (else their first) when they have one, an empty
 * number field when they do not. Pre-selecting a SAVED car is not a guess the way a defaulted car
 * category would be — it is the car they told us is theirs, and they can change it here.
 */
export function initialCarNumber(vehicles: readonly VehicleDto[]): CarNumberSelection {
  const preferred = vehicles.find((v) => v.is_default) ?? vehicles[0];
  return preferred === undefined ? { kind: 'new', plate: '' } : { kind: 'saved', id: preferred.id };
}

interface CarNumberChoiceProps {
  vehicles: readonly VehicleDto[];
  selection: CarNumberSelection;
  onChange: (selection: CarNumberSelection) => void;
}

/**
 * THE CAR NUMBER — required on a customer's first booking (2026-10-13).
 *
 * The driver drives the customer's own car, so the number plate is how they find it at the kerb.
 * A customer with no car on file types it here once; it is saved to their profile with the booking,
 * and every later booking offers it as a chip instead of asking again. "Add another" is there for
 * the household with two cars.
 *
 * Uppercased as typed, because that is how a plate is written and read — the server stores it the
 * same way, so what the customer sees here is what the driver sees.
 */
export function CarNumberChoice({ vehicles, selection, onChange }: CarNumberChoiceProps): ReactElement {
  const typing = selection.kind === 'new';
  const answered = isCarNumberReady(selection);

  return (
    <View style={styles.root}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>Car number</Text>
        {answered ? null : <Text style={styles.required}>Required</Text>}
      </View>

      {vehicles.length === 0 ? null : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.row}
        >
          {vehicles.map((vehicle) => (
            <Chip
              key={vehicle.id}
              label={vehicle.plate_number}
              selected={selection.kind === 'saved' && selection.id === vehicle.id}
              onPress={() => onChange({ kind: 'saved', id: vehicle.id })}
            />
          ))}
          <Chip
            label="+ Add another"
            selected={typing}
            onPress={() => onChange({ kind: 'new', plate: typing ? selection.plate : '' })}
          />
        </ScrollView>
      )}

      {typing ? (
        <>
          <TextInput
            value={selection.plate}
            onChangeText={(plate) => onChange({ kind: 'new', plate: plate.toUpperCase() })}
            placeholder="e.g. WB 74 AB 1234"
            placeholderTextColor={colors.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={16}
            style={styles.input}
            accessibilityLabel="Your car number"
          />
          <Text style={styles.hint}>
            {vehicles.length === 0
              ? 'Your driver uses this to find your car. We save it for your next booking.'
              : 'We save this car to your profile too.'}
          </Text>
        </>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && !selected && styles.chipPressed,
      ]}
    >
      <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The same ruled block as `CarChoice` above it, so the two read as one "your car" section.
  root: { marginBottom: space.md },

  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },
  required: {
    ...text.caption,
    color: colors.danger,
    fontFamily: fontFamily.semibold,
    fontSize: 11,
  },

  row: { flexDirection: 'row', gap: space.sm, paddingTop: space.sm, paddingRight: space.md },

  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipPressed: { backgroundColor: colors.bgSunken },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted, fontFamily: fontFamily.semibold },
  chipLabelSelected: { color: colors.fg },

  input: {
    ...text.body,
    color: colors.fg,
    fontFamily: fontFamily.semibold,
    letterSpacing: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.sm,
  },
  hint: { ...text.caption, color: colors.muted, marginTop: space.xs },
});
