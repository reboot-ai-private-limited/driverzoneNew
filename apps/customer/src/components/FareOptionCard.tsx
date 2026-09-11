import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { QuoteOptionDto } from '@driverzone/contracts';
import { includedCopy } from '@/features/booking/quote';
import { colors, fontFamily, radius, shadow, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

interface FareOptionCardProps {
  option: QuoteOptionDto;
  selected: boolean;
  onPress: () => void;
  /** Fare lines are shown for the selected option only — see the note on the breakdown below. */
  showBreakdown: boolean;
}

/**
 * One buyable option: what it is, what it includes, what it costs.
 *
 * THE PRICE IS THE SERVER'S STRING. `amount_display` is rendered verbatim and never recomputed
 * from `amount_paise` — Hermes ships a reduced ICU on Android and the lakh/crore grouping is
 * exactly the locale data that goes missing, so a client-side format shows `₹1,00,000` on one
 * phone and `₹100,000` on another. The paise are here to compare with, not to print.
 *
 * `label` is rendered verbatim for the same reason: the server sends '3 Hours' or
 * 'PKG-3 — One way' already display-ready, so a new package name needs no app release.
 *
 * **The breakdown opens for the selected option only, and is not collapsible separately.** An
 * independent disclosure would let a customer read one option's lines while a different one is
 * selected — two prices on screen, one of them not the one they are about to pay. Tying the two
 * together makes that state unreachable rather than merely unlikely.
 *
 * **Two animated layers, not one, on purpose.** The outer `Animated.View` carries `layout` —
 * cards reflow when the breakdown above them opens or closes — and the inner one carries the
 * press `transform`. Reanimated warns (and once did, right here in this app) when a layout
 * animation and a transform-style animation share one component; splitting them is the same fix
 * `DraggableSheet` needed.
 */
export function FareOptionCard({
  option,
  selected,
  onPress,
  showBreakdown,
}: FareOptionCardProps): ReactElement {
  const included = includedCopy(option);
  const icon = packageIcon(option);

  const pressed = useSharedValue(0);
  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withTiming(1 - pressed.value * 0.015, { duration: 100 }) }],
  }));

  return (
    <Animated.View layout={LinearTransition.duration(180)}>
      <Animated.View style={pressStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={() => {
            pressed.value = 1;
          }}
          onPressOut={() => {
            pressed.value = 0;
          }}
          accessibilityRole="radio"
          accessibilityState={{ selected }}
          accessibilityLabel={`${option.label}, ${option.fare.total.amount_display}${
            included === null ? '' : `, ${included}`
          }`}
          style={[styles.card, selected && styles.cardSelected]}
        >
          {selected ? <View style={styles.accent} /> : null}

          <View style={styles.head}>
            <View style={[styles.iconBubble, selected && styles.iconBubbleSelected]}>
              <Feather name={icon} size={17} color={selected ? colors.brandOnFg : colors.fg} />
            </View>

            <View style={styles.headText}>
              <Text style={styles.label} numberOfLines={1}>
                {option.label}
              </Text>
              {included === null ? null : (
                <View style={styles.includedPill}>
                  <Text style={styles.included}>{included}</Text>
                </View>
              )}
            </View>

            <View style={styles.priceBlock}>
              <Text style={styles.price}>{option.fare.total.amount_display}</Text>
              {/* Says WHICH total, since the breakdown below no longer spells the tax out. */}
              <Text style={styles.priceNote}>incl. taxes</Text>
            </View>

            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected ? <Feather name="check" size={12} color={colors.brandOnFg} /> : null}
            </View>
          </View>

          {showBreakdown ? (
            <Animated.View
              entering={FadeIn.duration(160)}
              exiting={FadeOut.duration(120)}
              style={styles.breakdown}
            >
              {option.fare.lines.map((line) => (
                // `code` is the stable identity; `label` is prose the server may rewrite, so it is
                // the key that must not be the label.
                <Row
                  key={line.code}
                  icon={lineIcon(line.code)}
                  label={line.label}
                  value={line.amount.amount_display}
                />
              ))}

              <View style={styles.rule} />

              {/*
                ONE FIGURE, TAX ALREADY IN IT. A Subtotal and a Tax row used to sit above this,
                and the pair invited the reading the total is meant to close — that the number
                below is a "before tax" price with something still to be added at the end. The
                total has always been tax-inclusive (`computeFare` rounds the total and derives
                tax as the remainder); the caption states that rather than making the customer
                add two rows to check it. The tax is still on the quote for anyone who needs the
                figure — it is simply not what this card is for.
              */}
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{option.fare.total.amount_display}</Text>
              </View>
              <Text style={styles.totalNote}>Including all taxes</Text>
            </Animated.View>
          ) : null}
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * What the option itself is buying, not what is inside it — `included_minutes` already decides
 * that split (`includedCopy`). Incity is bought by the clock, outstation by the road, and the
 * icon says which before the customer reads a word.
 */
function packageIcon(option: QuoteOptionDto): FeatherName {
  return option.included_minutes === null ? 'map' : 'clock';
}

/**
 * A line's own icon, keyed on `code` — the stable identity, never `label`, which is prose the
 * server may rewrite. `default` is load-bearing, exactly as `unavailableTitle`'s is: a fare line
 * code this build has never seen still gets a sensible glyph rather than none at all.
 */
function lineIcon(code: string): FeatherName {
  switch (code) {
    case 'RETURN_DRIVER_ALLOWANCE':
      return 'corner-up-left';
    case 'PICKUP_FEE':
      return 'map-pin';
    case 'NIGHT':
      return 'moon';
    case 'EARLY_MORNING':
      return 'sunrise';
    case 'INSURANCE':
      return 'shield';
    default:
      return 'tag';
  }
}

function Row({
  icon,
  label,
  value,
}: {
  /** Absent for Subtotal/Tax — those are not fare lines, just the two numbers underneath them. */
  icon?: FeatherName;
  label: string;
  value: string;
}): ReactElement {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelGroup}>
        {icon === undefined ? null : (
          <Feather name={icon} size={12} color={colors.faint} style={styles.rowIcon} />
        )}
        <Text style={styles.rowLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    marginBottom: space.sm,
    overflow: 'hidden',
    ...shadow.soft,
  },
  // A 2px ink border rather than a yellow fill: yellow is a surface in this palette and its
  // contrast against white is ~1.1:1, so a yellow-filled card would not read as chosen at all.
  cardSelected: { borderColor: colors.fg, borderWidth: 2, ...shadow.card },
  // A left rail rather than a filled card, for the same reason — it reads as "this one" without
  // needing yellow to carry the meaning, and it survives the breakdown expanding underneath it.
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.fg,
  },

  head: { flexDirection: 'row', alignItems: 'center' },

  iconBubble: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.sm,
  },
  iconBubbleSelected: { backgroundColor: colors.fg },

  headText: { flex: 1, paddingRight: space.sm },
  label: { ...text.heading, color: colors.fg },
  includedPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.pill,
    paddingHorizontal: space.xs,
    paddingVertical: 2,
    marginTop: 4,
  },
  included: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },

  priceBlock: { alignItems: 'flex-end' },
  price: { fontSize: 21, lineHeight: 27, fontFamily: fontFamily.bold, color: colors.fg },
  priceNote: { ...text.caption, color: colors.faint },

  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: space.sm,
  },
  radioSelected: { backgroundColor: colors.fg, borderColor: colors.fg },

  breakdown: {
    marginTop: space.md,
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  rowLabelGroup: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: space.sm },
  rowIcon: { marginRight: 6 },
  rowLabel: { ...text.body, color: colors.muted, flexShrink: 1 },
  rowValue: { ...text.body, color: colors.fg },
  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.sm },

  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSunken,
    borderRadius: radius.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm,
    marginTop: 2,
  },
  totalLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  totalValue: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold, fontSize: 15 },
  /** Right-aligned under the figure it qualifies, so it reads as part of the total, not a row. */
  totalNote: { ...text.caption, color: colors.faint, textAlign: 'right' },
});
