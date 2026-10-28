import type { BookingRiderInput } from '@driverzone/contracts';
import * as Haptics from 'expo-haptics';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { isValidIndianMobile, normaliseInput, toE164 } from '@/features/auth/phoneNumber';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/**
 * Who is travelling: the customer themselves, or someone they are booking for. The number is kept
 * as the bare 10-digit national form while typing — the same field shape as the login screen — and
 * only converted to E.164 when the request is built.
 */
export type RiderSelection = { kind: 'self' } | { kind: 'other'; name: string; national: string };

export const SELF_RIDER: RiderSelection = { kind: 'self' };

/** Ready to book with: travelling themselves, or a name and a valid Indian mobile for the passenger. */
export function isRiderReady(selection: RiderSelection): boolean {
  if (selection.kind === 'self') return true;
  return selection.name.trim() !== '' && isValidIndianMobile(selection.national);
}

/** The request field — absent when the customer is travelling themselves. */
export function toRiderInput(selection: RiderSelection): BookingRiderInput | undefined {
  if (selection.kind === 'self') return undefined;
  return { name: selection.name.trim(), phone: toE164(selection.national) };
}

interface RiderChoiceProps {
  selection: RiderSelection;
  onChange: (selection: RiderSelection) => void;
}

/**
 * BOOKING FOR SOMEONE ELSE (2026-10-28).
 *
 * Off by default and not remembered between bookings: most trips are the customer's own, and a
 * passenger carried over silently from last week would send the driver looking for the wrong
 * person. The start code still shows in the booker's app — they pass it on — so the hint says so
 * here, before they book, rather than leaving them to discover it at the kerb.
 */
export function RiderChoice({ selection, onChange }: RiderChoiceProps): ReactElement {
  const other = selection.kind === 'other';
  const numberTyped = other && selection.national.length > 0;
  const numberBad = numberTyped && !isValidIndianMobile(selection.national);

  return (
    <View style={styles.root}>
      <Text style={styles.label}>Who is travelling?</Text>

      <View style={styles.row}>
        <Chip label="Myself" selected={!other} onPress={() => onChange(SELF_RIDER)} />
        <Chip
          label="Someone else"
          selected={other}
          onPress={() => (other ? undefined : onChange({ kind: 'other', name: '', national: '' }))}
        />
      </View>

      {other ? (
        <>
          <TextInput
            value={selection.name}
            onChangeText={(name) => onChange({ ...selection, name })}
            placeholder="Passenger's name"
            placeholderTextColor={colors.faint}
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={80}
            style={styles.input}
            accessibilityLabel="Passenger's name"
          />
          <View style={[styles.phoneRow, numberBad && styles.inputBad]}>
            <Text style={styles.dialCode}>+91</Text>
            <TextInput
              value={selection.national}
              onChangeText={(raw) => onChange({ ...selection, national: normaliseInput(raw) })}
              placeholder="Passenger's mobile number"
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              maxLength={10}
              style={styles.phoneInput}
              accessibilityLabel="Passenger's mobile number"
            />
          </View>
          <Text style={[styles.hint, numberBad && styles.hintBad]}>
            {numberBad
              ? 'Enter a 10-digit mobile number.'
              : 'Your driver will contact them at pickup. The start code shows in your app — share it with them.'}
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
  // The same ruled block as `CarNumberChoice` above it.
  root: { marginBottom: space.md },

  label: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },

  row: { flexDirection: 'row', gap: space.sm, paddingTop: space.sm },

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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginTop: space.sm,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    marginTop: space.sm,
  },
  inputBad: { borderColor: colors.danger },
  dialCode: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold, marginRight: space.sm },
  phoneInput: { ...text.body, color: colors.fg, flex: 1, paddingVertical: space.sm },
  hint: { ...text.caption, color: colors.muted, marginTop: space.xs },
  hintBad: { color: colors.danger },
});
