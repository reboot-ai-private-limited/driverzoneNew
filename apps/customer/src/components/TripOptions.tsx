import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import type { Direction, ServiceType } from '@driverzone/contracts';
import { DirectionToggle } from '@/components/DirectionToggle';
import { formatWhen, returnProblem, scheduleProblem } from '@/features/booking/schedule';
import { colors, radius, space, text } from '@/theme/theme';

type FeatherName = ComponentProps<typeof Feather>['name'];

interface TripOptionsProps {
  /**
   * What the server said this trip is, or `null` before the first quote has answered.
   *
   * THREE STATES, NOT TWO, and the null one is why this is not a boolean. Only outstation has a
   * direction to choose, but the app cannot know which product a trip is until it asks — so
   * before the answer arrives the choice is OFFERED. Hiding it until the quote resolves means the
   * customer sets a destination, sees only a pickup time, and reasonably concludes the app has no
   * round trips at all.
   */
  serviceType: ServiceType | null;
  direction: Direction;
  onDirectionChange: (direction: Direction) => void;
  /** Locked while a price is in flight — every control here changes the price. */
  busy?: boolean;

  /** The pickup instant, or `null` when nothing is chosen yet — which blocks Continue. */
  scheduledAt: Date | null;
  onPickTime: () => void;

  /** Local-only, see `RETURN_IS_LOCAL_ONLY`. Rendered only for a round trip. */
  returnAt: Date | null;
  onPickReturn: () => void;
  onClearReturn: () => void;
}

/**
 * The trip's terms, in the home sheet, directly under the pickup and destination.
 *
 * **It replaced the saved-places list here, and that is a deliberate trade.** Both cannot occupy
 * the same stretch of a sheet that also has to hold the trip summary and Continue. Saved places
 * answer *where*, and the sheet already has that answer by the time this block renders — a
 * destination is set, which is the only reason these controls appear. What the customer does not
 * yet have is *when* and *which way*, and both change the price. The saved list is still one tap
 * away inside either picker, where it is answering the question it is actually for.
 *
 * **Everything here re-quotes.** Direction selects a different product with its own fare;
 * `scheduledAt` moves the trip across the early-morning and late-night surcharge windows. Neither
 * is a display preference, which is why the whole block locks while a price is in flight rather
 * than letting a customer stack three changes into one confusing answer.
 */
export function TripOptions({
  serviceType,
  direction,
  onDirectionChange,
  busy = false,
  scheduledAt,
  onPickTime,
  returnAt,
  onPickReturn,
  onClearReturn,
}: TripOptionsProps): ReactElement {
  const whenProblem = scheduleProblem(scheduledAt);
  const backProblem = returnProblem(returnAt, scheduledAt);

  /** Offered while unknown, kept for outstation, withdrawn only once the answer rules it out. */
  const showDirection = serviceType !== 'INCITY';

  return (
    <Animated.View layout={LinearTransition.duration(180)} style={styles.root}>
      {showDirection ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <DirectionToggle value={direction} onChange={onDirectionChange} disabled={busy} />
        </Animated.View>
      ) : (
        /*
          SAYS WHY IT WENT, rather than leaving a gap where a control was a second ago. A customer
          who saw one-way/round-trip on the previous destination and finds it missing on this one
          has been given a puzzle; one line turns it into a fact about their trip.
        */
        <Animated.View entering={FadeIn.duration(180)}>
          <Text style={styles.incity}>
            This is a trip within the city, so it is charged by the hour — round trips apply to
            out-of-town journeys.
          </Text>
        </Animated.View>
      )}

      <OptionRow
        icon="clock"
        label="Pickup"
        // A PROMPT, NOT A VALUE. Every trip has to name its pickup time, so an unset row says what
        // to do about it rather than showing "Now" — which read as an answer, and as the one
        // answer the hour's lead time refuses.
        value={scheduledAt === null ? 'Select a time' : formatWhen(scheduledAt)}
        muted={scheduledAt === null}
        /*
         * NO CLEAR AFFORDANCE. There is no default to clear back to: emptying this row cannot
         * produce a bookable trip, only an incomplete one, so the way to change a pickup time is
         * to pick another.
         */
        onPress={onPickTime}
        disabled={busy}
        problem={whenProblem}
      />

      {direction === 'ROUND_TRIP' ? (
        <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)}>
          <OptionRow
            icon="corner-up-left"
            label="Return"
            value={returnAt === null ? 'Not set' : formatWhen(returnAt)}
            muted={returnAt === null}
            onClear={returnAt === null ? undefined : onClearReturn}
            onPress={onPickReturn}
            disabled={busy}
            problem={backProblem}
            /*
              SAYS SO ON THE ROW, because it would otherwise be the one control here that looks
              exactly like the others and does something entirely different — the others reprice
              the trip, this one is remembered on the phone and goes nowhere. A customer who sets
              it and later finds the driver was never told would be right to feel misled, and the
              honest place to say so is the control itself, not a release note.
            */
            note="Saved on this device for now"
          />
        </Animated.View>
      ) : null}

      {/*
        A RIDE-INSURANCE SWITCH USED TO SIT HERE. The feature is withdrawn, so the control went
        with it and `useTripQuote` now prices every trip without the line — see the note there.
        Nothing replaces it: the block is back to answering only when and which way.
      */}
    </Animated.View>
  );
}

function OptionRow({
  icon,
  label,
  value,
  muted = false,
  onPress,
  onClear,
  disabled = false,
  problem = null,
  note,
}: {
  icon: FeatherName;
  label: string;
  value: string;
  muted?: boolean;
  onPress: () => void;
  onClear?: (() => void) | undefined;
  disabled?: boolean;
  problem?: string | null;
  note?: string;
}): ReactElement {
  return (
    <View style={styles.rowWrap}>
      <View style={styles.row}>
        <Pressable
          onPress={onPress}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value}. Tap to change.`}
          accessibilityState={{ disabled }}
          style={({ pressed }) => [
            styles.rowMain,
            problem !== null && styles.rowError,
            pressed && !disabled && styles.pressed,
            disabled && styles.disabled,
          ]}
        >
          <Feather name={icon} size={16} color={colors.muted} style={styles.rowIcon} />
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={[styles.rowValue, muted && styles.rowValueMuted]} numberOfLines={1}>
            {value}
          </Text>
          <Feather name="chevron-right" size={15} color={colors.faint} />
        </Pressable>

        {onClear === undefined ? null : (
          <Pressable
            onPress={onClear}
            disabled={disabled}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
          >
            <Feather name="x" size={14} color={colors.muted} />
          </Pressable>
        )}
      </View>

      {problem !== null ? (
        <Text style={styles.problem} accessibilityLiveRegion="polite">
          {problem}
        </Text>
      ) : note === undefined ? null : (
        <Text style={styles.note}>{note}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: space.sm },
  incity: {
    ...text.caption,
    color: colors.muted,
    marginBottom: space.sm,
    marginLeft: space.xs,
  },

  rowWrap: { marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 46,
    paddingHorizontal: space.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bgSunken,
  },
  rowError: { borderColor: colors.danger, backgroundColor: colors.card },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },

  rowIcon: { marginRight: space.sm },
  rowLabel: { ...text.label, color: colors.muted },
  // Pushed right and given the room: the VALUE is what the customer is checking when they glance
  // at this row, not the word "Pickup" they already know.
  rowValue: { ...text.label, color: colors.fg, flex: 1, textAlign: 'right', marginRight: space.xs },
  rowValueMuted: { color: colors.faint },

  clear: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSunken,
  },

  problem: { ...text.caption, color: colors.danger, marginTop: space.xs, marginLeft: space.xs },
  note: { ...text.caption, color: colors.faint, marginTop: space.xs, marginLeft: space.xs },

});
