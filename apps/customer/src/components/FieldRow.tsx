import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

interface FieldRowProps {
  icon?: FeatherName;
  label: string;
  /** Rendered after the label in lighter type — "(Optional)". */
  hint?: string;
  required?: boolean;
  /** Draws the focus ring. The screen owns which field has it, so only one ever does. */
  focused?: boolean;
  /**
   * Whether the control sits inside the bordered box. Off for a row of chips, which carry their
   * own outlines — a border around borders reads as a rendering fault.
   */
  boxed?: boolean;
  children: ReactNode;
  error?: string | null;
}

/**
 * One labelled field on the profile form: caption above, control below.
 *
 * The label sits OUTSIDE the box rather than inside it. Stacking both in one bordered row makes
 * every field 66pt tall and the form twice the height of the screen; lifting the caption out is
 * what lets six fields fit without scrolling past the save button.
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
  focused = false,
  boxed = true,
  children,
  error = null,
}: FieldRowProps): ReactElement {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
        {hint !== undefined ? <Text style={styles.hint}> {hint}</Text> : null}
      </Text>

      {boxed ? (
        <View style={[styles.box, focused && styles.boxFocused, error !== null && styles.boxError]}>
          {icon !== undefined ? (
            <Feather
              name={icon}
              size={18}
              color={focused ? colors.fg : colors.faint}
              style={styles.icon}
            />
          ) : null}
          <View style={styles.content}>{children}</View>
        </View>
      ) : (
        children
      )}

      {error !== null ? (
        <Text style={styles.errorText} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: space.md },
  label: { ...text.label, color: colors.muted, marginBottom: space.sm },
  required: { color: colors.danger },
  hint: { color: colors.faint, fontWeight: '400', fontFamily: fontFamily.regular },

  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 54,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
  },
  // The same focus treatment as the sign-in field: border to ink, fill to white.
  boxFocused: { borderColor: colors.fg, backgroundColor: colors.card },
  boxError: { borderColor: colors.danger, backgroundColor: colors.card },
  icon: { marginRight: space.sm },
  content: { flex: 1 },

  errorText: { ...text.caption, color: colors.danger, marginTop: space.xs },
});
