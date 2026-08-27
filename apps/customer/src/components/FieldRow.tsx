import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

interface FieldRowProps {
  icon: FeatherName;
  label: string;
  /** Rendered after the label in lighter type — "(Optional)", "*". */
  hint?: string;
  required?: boolean;
  children: ReactNode;
  error?: string | null;
}

/**
 * The bordered row shared by every field on the profile form: an icon in its own left cell,
 * divided from the content by a hairline.
 *
 * A wrapper rather than a full input component because the rows hold genuinely different
 * things — a text input, three toggle buttons, a date trigger, a select. Trying to make one
 * component render all of those produces a prop list nobody can read.
 */
export function FieldRow({
  icon,
  label,
  hint,
  required = false,
  children,
  error = null,
}: FieldRowProps): ReactElement {
  return (
    <View style={styles.wrap}>
      <View style={[styles.row, error !== null && styles.rowError]}>
        <View style={styles.iconCell}>
          <Feather name={icon} size={19} color={colors.muted} />
        </View>

        <View style={styles.content}>
          <Text style={styles.label}>
            {label}
            {required ? <Text style={styles.required}> *</Text> : null}
            {hint !== undefined ? <Text style={styles.hint}> {hint}</Text> : null}
          </Text>
          {children}
        </View>
      </View>

      {error !== null ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.sm },
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    minHeight: 66,
  },
  rowError: { borderColor: colors.danger },
  iconCell: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  content: { flex: 1, paddingHorizontal: space.md, paddingVertical: space.sm, justifyContent: 'center' },
  label: { ...text.caption, color: colors.muted },
  required: { color: colors.danger },
  hint: { color: colors.faint },
  errorText: { ...text.caption, color: colors.danger, marginTop: 4, marginLeft: 4 },
});
