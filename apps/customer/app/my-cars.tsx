import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  CAR_CATEGORIES,
  CAR_CATEGORY_LABELS,
  type CarCategory,
  type VehicleDto,
} from '@driverzone/contracts';
import { isPlateValid } from '@/components/CarNumberChoice';
import { PrimaryButton } from '@/components/PrimaryButton';
import { addVehicle, getProfile, removeVehicle, updateVehicle } from '@/lib/api/endpoints/customer';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * MY CARS — the customer's own cars, from the Profile tab (2026-10-13).
 *
 * The same list the booking sheet offers as chips under "Car number": a car added here is ready on
 * the next booking, and a number typed while booking shows up here. The driver drives the
 * customer's own car, so the plate is how they find it at the kerb.
 *
 * `category` is stored as the car-category code (`SEDAN`, …), the same value a booking saves when
 * the customer types a new number there — so a car saved either way reads the same on this list.
 */
export default function MyCarsScreen(): ReactElement {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });
  const cars = profile.data?.vehicles ?? [];

  const [adding, setAdding] = useState(false);
  const [plate, setPlate] = useState('');
  const [category, setCategory] = useState<CarCategory | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.profile.all() });

  const add = useMutation({
    mutationFn: () =>
      addVehicle({
        plate_number: plate.trim(),
        category: category ?? 'SEDAN',
        // The first car is the default anyway; saying so keeps the intent visible.
        ...(cars.length === 0 ? { is_default: true } : {}),
      }),
    onSuccess: async () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdding(false);
      setPlate('');
      setCategory(null);
      await refresh();
    },
  });

  const makeDefault = useMutation({
    mutationFn: (car: VehicleDto) => updateVehicle(car.id, { is_default: true }),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: (car: VehicleDto) => removeVehicle(car.id),
    onSuccess: refresh,
  });

  const canSave = isPlateValid(plate) && category !== null && !add.isPending;
  const error = add.error ?? makeDefault.error ?? remove.error;

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
        <Text style={styles.headerTitle}>My Cars</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {error !== null ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error instanceof Error ? error.message : 'Something went wrong. Please try again.'}
          </Text>
        ) : null}

        {profile.isPending ? (
          <ActivityIndicator color={colors.muted} style={styles.loading} />
        ) : cars.length === 0 && !adding ? (
          <Text style={styles.emptyBody}>
            No car saved yet. Add your car number so your driver can find your car.
          </Text>
        ) : (
          cars.map((car) => (
            <View key={car.id} style={styles.carRow}>
              <View style={styles.carIcon}>
                <Feather name="truck" size={16} color={colors.fg} />
              </View>
              <View style={styles.carText}>
                <View style={styles.plateRow}>
                  <Text style={styles.plate}>{car.plate_number}</Text>
                  {car.is_default ? (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>Default</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.carCategory}>{categoryLabel(car.category)}</Text>
                <View style={styles.carActions}>
                  {car.is_default ? null : (
                    <Pressable
                      onPress={() => makeDefault.mutate(car)}
                      disabled={makeDefault.isPending}
                      hitSlop={6}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>Make default</Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => remove.mutate(car)}
                    disabled={remove.isPending}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${car.plate_number}`}
                  >
                    {remove.isPending && remove.variables?.id === car.id ? (
                      <ActivityIndicator size="small" color={colors.danger} />
                    ) : (
                      <Text style={styles.linkDanger}>Remove</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            </View>
          ))
        )}

        {adding ? (
          <View style={styles.form}>
            <Text style={styles.label}>Car number</Text>
            <TextInput
              value={plate}
              onChangeText={(value) => setPlate(value.toUpperCase())}
              placeholder="e.g. WB 74 AB 1234"
              placeholderTextColor={colors.faint}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              maxLength={16}
              style={styles.input}
              accessibilityLabel="Car number"
            />

            <Text style={[styles.label, styles.labelSpaced]}>Car type</Text>
            <View style={styles.chips}>
              {CAR_CATEGORIES.map((value) => {
                const selected = value === category;
                return (
                  <Pressable
                    key={value}
                    onPress={() => setCategory(value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                      {CAR_CATEGORY_LABELS[value]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.formActions}>
              <PrimaryButton
                label="Save car"
                onPress={() => add.mutate()}
                loading={add.isPending}
                disabled={!canSave}
                showArrow={false}
              />
              <Pressable
                onPress={() => {
                  setAdding(false);
                  add.reset();
                }}
                accessibilityRole="button"
                style={styles.cancel}
              >
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => setAdding(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Feather name="plus" size={16} color={colors.fg} />
            <Text style={styles.addButtonText}>Add a car</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

/** A saved category code (`SEDAN`) as words; anything older or free-typed is shown as it is. */
function categoryLabel(category: string): string {
  return (CAR_CATEGORY_LABELS as Record<string, string>)[category] ?? category;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.7 },
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
  loading: { marginTop: space.lg },
  emptyBody: { ...text.body, color: colors.muted, marginBottom: space.md },
  error: { ...text.caption, color: colors.danger, marginBottom: space.sm },

  carRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  carIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carText: { flex: 1 },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  plate: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, letterSpacing: 1 },
  defaultBadge: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 1,
  },
  defaultBadgeText: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold, fontSize: 11 },
  carCategory: { ...text.caption, color: colors.muted, marginTop: 2 },
  carActions: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  link: { ...text.caption, color: colors.link, fontFamily: fontFamily.semibold },
  linkDanger: { ...text.caption, color: colors.danger, fontFamily: fontFamily.semibold },

  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: space.md,
    marginTop: space.md,
  },
  addButtonText: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },

  form: { marginTop: space.md },
  label: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },
  labelSpaced: { marginTop: space.md },
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
    marginTop: space.xs,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted, fontFamily: fontFamily.semibold },
  chipLabelSelected: { color: colors.fg },
  formActions: { marginTop: space.lg },
  cancel: { alignItems: 'center', paddingVertical: space.md },
  cancelLabel: { ...text.body, color: colors.muted },
});
