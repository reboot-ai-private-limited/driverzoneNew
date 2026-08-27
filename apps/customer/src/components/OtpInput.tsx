import { type ReactElement, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radius } from '@/theme/theme';

interface OtpInputProps {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  /** Fires when the last digit lands, so the screen can submit without a second tap. */
  onFilled?: (code: string) => void;
  editable?: boolean;
  invalid?: boolean;
}

/**
 * Six boxes, ONE real `TextInput`.
 *
 * Six separate inputs is the obvious build and it is wrong: backspace on an empty cell has to
 * move focus backwards, a paste of "483920" must fill all six rather than putting six characters
 * in the first, and both platforms' SMS autofill target a single field. Chasing focus between six
 * refs reproduces all of that badly. So the input below is transparent and stretched across the
 * whole row, and the boxes are non-interactive `View`s rendering its value.
 *
 * `autoComplete="sms-otp"` (Android) and `textContentType="oneTimeCode"` (iOS) are what make the
 * keyboard offer the code from the SMS — the "Auto reading OTP" affordance in the design is the
 * platform's, not something the app polls for.
 */
export function OtpInput({
  value,
  onChange,
  length = 6,
  onFilled,
  editable = true,
  invalid = false,
}: OtpInputProps): ReactElement {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  function handleChange(raw: string): void {
    // Strip anything that is not a digit BEFORE truncating: a pasted "48-3920" would otherwise
    // lose its last digit to the length cap and silently submit five.
    const digits = raw.replace(/[^0-9]/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length) onFilled?.(digits);
  }

  const cells = Array.from({ length }, (_, index) => index);
  // The caret sits on the first empty cell, except at full length where it stays on the last.
  const activeIndex = Math.min(value.length, length - 1);

  return (
    <Pressable
      onPress={() => inputRef.current?.focus()}
      accessibilityRole="none"
      style={styles.root}
    >
      <View style={styles.row} pointerEvents="none">
        {cells.map((index) => {
          const digit = value[index] ?? '';
          const isActive = focused && index === activeIndex && editable;
          return (
            <View
              key={index}
              style={[
                styles.cell,
                digit !== '' && styles.cellFilled,
                isActive && styles.cellActive,
                invalid && styles.cellInvalid,
              ]}
            >
              <Text style={styles.digit}>{digit}</Text>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={editable}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={length}
        autoFocus
        // Not `opacity: 0` alone — an invisible input still needs to cover the boxes to receive
        // the tap, and on Android a zero-opacity field can lose the autofill prompt anchor.
        style={styles.hiddenInput}
        caretHidden
        accessibilityLabel={`Enter the ${length} digit verification code`}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: {
    flex: 1,
    maxWidth: 54,
    aspectRatio: 0.86,
    marginHorizontal: 4,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellFilled: { borderColor: colors.borderStrong },
  cellActive: { borderColor: colors.focus, borderWidth: 2 },
  cellInvalid: { borderColor: colors.danger },
  digit: { fontSize: 22, fontWeight: '700', color: colors.fg },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
});
