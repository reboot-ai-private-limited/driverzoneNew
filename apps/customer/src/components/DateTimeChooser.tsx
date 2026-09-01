import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

interface DateTimeChooserProps {
  visible: boolean;
  /** The current value, or `null` when nothing is chosen yet — then `anchor` is where it opens. */
  value: Date | null;
  anchor: Date;
  minimumDate?: Date | undefined;
  maximumDate?: Date | undefined;
  onConfirm: (at: Date) => void;
  onCancel: () => void;
  /** iOS only — the sheet's heading. Android's dialogs carry their own. */
  title?: string;
}

/**
 * A date AND a time, on both platforms, from a library that will not give you both at once.
 *
 * **`mode="datetime"` IS iOS-ONLY.** Asking for it on Android is not a graceful degradation — it
 * throws `TypeError: Cannot read property 'dismiss' of undefined` from inside the native module,
 * because there is no Android dialog for the combined mode to dismiss. The platforms need
 * genuinely different flows, and this component owns that split so no caller has to know:
 *
 *   ANDROID — `DateTimePickerAndroid.open()`, the imperative API, chained date → time.
 *   IMPERATIVE RATHER THAN DECLARATIVE, AND THAT IS THE FIX FOR MORE THAN THE CRASH. Rendering
 *   two sequential `<DateTimePicker>` elements makes the second dialog's correctness depend on a
 *   React state update landing between two native dialogs; the merged instant is then read from
 *   whichever `draft` the second element's closure happened to capture. Here both halves live in
 *   one closure with no state and no remount between them, so what the customer picked is what
 *   gets merged.
 *
 *   iOS — one combined spinner, which is what iOS users expect, inside the app's own
 *   `BottomSheet` with a Done button. The sheet is NOT decoration: an iOS spinner fires `onChange`
 *   continuously as it scrolls, so committing on change would slam the picker shut on the first
 *   flick past the first value. Something has to say when the customer is finished, and on this
 *   platform that has to be a button.
 */
export function DateTimeChooser({
  visible,
  value,
  anchor,
  minimumDate,
  maximumDate,
  onConfirm,
  onCancel,
  title = 'Pick a time',
}: DateTimeChooserProps): ReactElement | null {
  const [draft, setDraft] = useState<Date>(() => value ?? anchor);

  /**
   * ONE DIALOG PER MOUNT, and this ref rather than a cleanup flag is the difference between the
   * customer's choice landing and vanishing.
   *
   * The obvious guard — set `abandoned = true` in the effect's cleanup, check it in the callbacks —
   * is actively wrong here. Any double-invocation of the effect (React's development remount, a
   * fast re-render) runs the FIRST cleanup before the customer has touched anything, so the dialog
   * they are looking at reports back into a closure that has already decided to ignore it. They
   * pick a date, they pick a time, and the row still says "Now".
   *
   * There is nothing for such a guard to protect anyway: `onConfirm` and `onCancel` belong to the
   * PARENT, which stays mounted the whole time. Only this component goes away, and calling a live
   * parent's callback after that is ordinary.
   */
  const opened = useRef(false);

  useEffect(() => {
    if (Platform.OS !== 'android' || !visible || opened.current) return;
    opened.current = true;

    /*
     * The whole sequence reads from ONE captured base. Nothing here goes through React state
     * between the two dialogs, which is what makes the merge deterministic: the day comes from
     * the first answer, the clock from the second, and neither can be read from a render that
     * has not happened yet.
     */
    const base = value ?? anchor;

    DateTimePickerAndroid.open({
      value: base,
      mode: 'date',
      /*
       * FLOORED TO THE START OF THE DAY. `minimumDate` is an instant — "an hour from now" — but a
       * date dialog picks a DAY, and handing it a mid-afternoon floor makes today unselectable
       * for anyone booking in the morning. The real bound is enforced on the merged result by
       * `scheduleProblem`, which can see both halves; this one only has to stop the customer
       * scrolling to last week.
       */
      ...(minimumDate === undefined ? {} : { minimumDate: startOfDay(minimumDate) }),
      ...(maximumDate === undefined ? {} : { maximumDate }),
      onChange: (event, pickedDate) => {
        // Android reports a cancel as type 'dismissed' and closes itself either way.
        if (event.type !== 'set' || pickedDate === undefined) {
          onCancel();
          return;
        }

        const withDay = withDatePart(base, pickedDate);

        DateTimePickerAndroid.open({
          value: withDay,
          mode: 'time',
          /*
           * 24-HOUR, EXPLICITLY. Left to the device default this is a 12-hour clock on most
           * phones here, and a customer who means 12 PM has no way to tell from the row
           * afterwards whether the app understood noon or midnight. Reading the hour back
           * unambiguously is worth more on this control than matching the system convention,
           * because getting it wrong silently produces a pickup time in the past.
           */
          is24Hour: true,
          /*
           * No min/max: Android's time dialog ignores them — it has no notion of which day it is
           * picking for. A combination that lands too early is caught by `scheduleProblem` on the
           * row, which is also the only place that can explain it.
           */
          onChange: (timeEvent, pickedTime) => {
            if (timeEvent.type !== 'set' || pickedTime === undefined) {
              onCancel();
              return;
            }
            onConfirm(withTimePart(withDay, pickedTime));
          },
        });
      },
    });

    // Opening is a one-shot effect keyed on becoming visible. `value`/`anchor` are read from the
    // closure at that moment and must NOT retrigger it: the parent rebuilds `anchor` on every
    // render, which would otherwise reopen the dialog under the customer's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Re-seed the spinner whenever it opens, so a cancelled-then-reopened sheet does not resume on
  // an instant the customer walked away from.
  useEffect(() => {
    if (visible) setDraft(value ?? anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Android draws nothing of its own — the dialogs above are native windows.
  if (!visible || Platform.OS === 'android') return null;

  return (
    <BottomSheet visible={visible} onClose={onCancel}>
      <Text style={styles.title}>{title}</Text>

      <DateTimePicker
        value={draft}
        mode="datetime"
        display="spinner"
        {...(minimumDate === undefined ? {} : { minimumDate })}
        {...(maximumDate === undefined ? {} : { maximumDate })}
        // Fires on every scroll tick, so this only ever updates the draft. Committing happens on
        // Done and nowhere else.
        onChange={(_event, selected) => {
          if (selected !== undefined) setDraft(selected);
        }}
      />

      <View style={styles.actions}>
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.cancelLabel}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => onConfirm(draft)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.action, styles.done, pressed && styles.pressed]}
        >
          <Text style={styles.doneLabel}>Done</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

/** The day from `part`, the clock from `base`. */
function withDatePart(base: Date, part: Date): Date {
  const merged = new Date(base);
  /*
   * All three fields in ONE call. Setting them separately lets an intermediate state exist — the
   * 31st of a 30-day month rolls forward a day before the day-of-month is applied — and the
   * result is a pickup one day later than the one that was tapped.
   */
  merged.setFullYear(part.getFullYear(), part.getMonth(), part.getDate());
  return merged;
}

/** The clock from `part`, the day from `base`. Seconds are zeroed — nobody picked them. */
function withTimePart(base: Date, part: Date): Date {
  const merged = new Date(base);
  merged.setHours(part.getHours(), part.getMinutes(), 0, 0);
  return merged;
}

/** Midnight at the start of the given instant's local day. */
function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

const styles = StyleSheet.create({
  title: { ...text.heading, color: colors.fg, marginBottom: space.sm },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  action: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSunken,
  },
  done: { backgroundColor: colors.fg },
  pressed: { opacity: 0.85 },
  cancelLabel: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },
  doneLabel: { ...text.label, color: colors.brandOnFg, fontFamily: fontFamily.bold },
});
