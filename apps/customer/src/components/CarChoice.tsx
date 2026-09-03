import { type ReactElement } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CAR_CATEGORIES,
  CAR_CATEGORY_LABELS,
  VEHICLE_TYPE_LABELS,
  VEHICLE_TYPE_PREFERENCES,
  type CarCategory,
  type VehicleTypePreference,
} from '@driverzone/contracts';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface CarChoiceProps {
  category: CarCategory | null;
  vehicleType: VehicleTypePreference | null;
  onCategory: (value: CarCategory) => void;
  onVehicleType: (value: VehicleTypePreference) => void;
}

/**
 * Which car the driver will be driving — the customer's own, since that is the service.
 *
 * NOT A PRICE, AND DELIBERATELY NOT AMONG THE FARE CARDS. An SUV and a hatchback pay the same
 * fare for the same trip (retired as a pricing dimension on 2026-08-28), so a row of car types
 * sitting inside a list of prices would read as a choice between prices.
 *
 * But it does NOT live inside the fare list's scroll view either, which is where it started. That
 * list is capped at a few hundred points with its scroll indicator hidden, so anything below the
 * last fare card was invisible — and this gates the Confirm button. A required input that the
 * customer has to discover by scrolling a region that does not look scrollable is a broken form,
 * whatever it costs the fares in height.
 *
 * EACH ROW SCROLLS SIDEWAYS rather than wrapping, so the block is exactly two lines tall however
 * many categories exist. Wrapping made the sheet grow by a row the day a sixth category is added.
 *
 * What they decide is WHO RINGS: `MongoDriverPool` matches both values against the driver's
 * declared competencies, and a driver who cannot drive this car is never offered the trip.
 *
 * NOTHING IS PRESELECTED, and Confirm stays disabled until both are answered. A defaulted Sedan
 * would be a guess the customer never made, and the cost of guessing wrong here is a driver
 * arriving who cannot drive the car in the driveway.
 */
export function CarChoice({
  category,
  vehicleType,
  onCategory,
  onVehicleType,
}: CarChoiceProps): ReactElement {
  return (
    <View style={styles.root}>
      <Row label="Your car" answered={category !== null}>
        {CAR_CATEGORIES.map((value) => (
          <Chip
            key={value}
            label={CAR_CATEGORY_LABELS[value]}
            selected={value === category}
            onPress={() => onCategory(value)}
          />
        ))}
      </Row>

      <Row label="How it drives" answered={vehicleType !== null} spaced>
        {VEHICLE_TYPE_PREFERENCES.map((value) => (
          <Chip
            key={value}
            label={VEHICLE_TYPE_LABELS[value]}
            selected={value === vehicleType}
            onPress={() => onVehicleType(value)}
          />
        ))}
      </Row>
    </View>
  );
}

/**
 * A labelled row of chips. The "Required" tag is the affordance that survives the sheet being
 * scrolled past — it is what tells a customer WHY Confirm is dead, right next to the thing that
 * would fix it, rather than only in the hint under the button.
 */
function Row({
  label,
  answered,
  spaced = false,
  children,
}: {
  label: string;
  answered: boolean;
  spaced?: boolean;
  children: ReactElement[];
}): ReactElement {
  return (
    <View style={spaced ? styles.rowBlockSpaced : undefined}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {answered ? null : <Text style={styles.required}>Required</Text>}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // The chips are the touch targets; the row must not swallow a tap that lands between two.
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.row}
      >
        {children}
      </ScrollView>
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
  /*
   * A ruled block, not a bare pair of rows. It sits between the fare list and the confirm button
   * — two areas that are already busy — and without the divider the chips read as more of the
   * fare card above them rather than as a separate question.
   */
  root: {
    marginBottom: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  rowBlockSpaced: { marginTop: space.md },

  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  label: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },
  required: {
    ...text.caption,
    color: colors.danger,
    fontFamily: fontFamily.semibold,
    fontSize: 11,
  },

  // `paddingRight` rather than a gap after the last chip: it is what gives the horizontal scroll
  // somewhere to end, so the final chip does not sit flush against the sheet edge.
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
  // Brand fill with ink on it — the same pairing every selected surface in this app uses.
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted, fontFamily: fontFamily.semibold },
  chipLabelSelected: { color: colors.fg },
});
