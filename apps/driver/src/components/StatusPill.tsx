import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, space } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

export type PillTone = 'neutral' | 'pending' | 'success' | 'danger';

interface StatusPillProps {
  label: string;
  tone?: PillTone;
  icon?: FeatherName;
}

/**
 * A small state chip — document status, onboarding status, duty status.
 *
 * Tone carries an ICON as well as a colour. Colour alone fails for the ~8% of men with a
 * red/green deficiency, and this app's population is overwhelmingly male; a verified and a
 * rejected document that differ only in hue is a genuinely dangerous ambiguity when the driver
 * is deciding what to re-upload.
 */
export function StatusPill({ label, tone = 'neutral', icon }: StatusPillProps): ReactElement {
  const palette = TONES[tone];
  const glyph = icon ?? palette.icon;

  return (
    <View style={[styles.root, { backgroundColor: palette.bg }]}>
      {glyph !== undefined ? (
        <Feather name={glyph} size={12} color={palette.fg} style={styles.icon} />
      ) : null}
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const TONES: Record<PillTone, { bg: string; fg: string; icon?: FeatherName }> = {
  neutral: { bg: colors.bgSunken, fg: colors.muted },
  pending: { bg: '#FFF6E0', fg: colors.warning, icon: 'clock' },
  success: { bg: colors.dutyOnBg, fg: colors.success, icon: 'check' },
  danger: { bg: '#FDEDEE', fg: colors.danger, icon: 'alert-circle' },
};

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  icon: { marginRight: 4 },
  label: { fontSize: 11, fontFamily: fontFamily.semibold, fontWeight: '600', letterSpacing: 0.2 },
});
