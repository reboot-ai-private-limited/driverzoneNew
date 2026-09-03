import DateTimePicker from '@react-native-community/datetimepicker';
import type { DocumentType, RequestDocumentUploadRequest } from '@driverzone/contracts';
import { type ReactElement, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { FieldRow } from '@/components/FieldRow';
import { PrimaryButton } from '@/components/PrimaryButton';
import {
  DOCUMENT_FIELDS,
  formatDate,
  toIsoDate,
} from '@/features/onboarding/documentFields';
import { documentLabel } from '@/features/onboarding/requirements';
import { colors, radius, space, text } from '@/theme/theme';

interface DocumentDetailsSheetProps {
  /** `null` closes the sheet. The type also selects which fields to render. */
  type: DocumentType | null;
  onCancel: () => void;
  /** Receives only the fields this type actually has, ready to send as-is. */
  onConfirm: (details: Omit<RequestDocumentUploadRequest, 'doc_type'>) => void;
}

type DateField = 'issued' | 'expires';

/**
 * The details a document carries, asked BEFORE the photo picker opens.
 *
 * Before the picker rather than after, because the metadata is read off the document the driver
 * is holding — they have it in hand at that moment. Asking afterwards means finding the card
 * again, and an upload that succeeded followed by a form is a flow drivers abandon halfway,
 * leaving a photo with no expiry date attached.
 *
 * Every field here is optional server-side (`requestDocumentUploadSchema`), so nothing blocks
 * the driver who does not have a number to hand. `expires_on` is the one worth pushing for —
 * `prd.md` FR-D6 blocks duty on expired documents, and that rule does nothing at all if the
 * date is never captured.
 */
export function DocumentDetailsSheet({
  type,
  onCancel,
  onConfirm,
}: DocumentDetailsSheetProps): ReactElement {
  const [number, setNumber] = useState('');
  const [subType, setSubType] = useState<string | null>(null);
  const [issuedOn, setIssuedOn] = useState<Date | null>(null);
  const [expiresOn, setExpiresOn] = useState<Date | null>(null);
  const [picking, setPicking] = useState<DateField | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  // Reset whenever a different document is opened. Without this, the licence number typed a
  // moment ago is still sitting in the field when the driver taps Aadhaar.
  useEffect(() => {
    setNumber('');
    setSubType(null);
    setIssuedOn(null);
    setExpiresOn(null);
    setPicking(null);
  }, [type]);

  // The sheet stays mounted through its own exit animation, so it must survive a null `type` for
  // those few frames rather than unmounting the moment the sheet starts closing.
  const spec = type === null ? {} : DOCUMENT_FIELDS[type];

  function handleConfirm(): void {
    // Built by OMISSION: the server treats an absent key as "not provided", and sending an empty
    // string would fail its `min(1)` check rather than being read as blank.
    const details: Omit<RequestDocumentUploadRequest, 'doc_type'> = {};

    const trimmed = number.trim();
    if (trimmed !== '') details.number = trimmed;
    if (subType !== null) details.sub_type = subType;
    if (issuedOn !== null) details.issued_on = toIsoDate(issuedOn);
    if (expiresOn !== null) details.expires_on = toIsoDate(expiresOn);

    onConfirm(details);
  }

  return (
    <BottomSheet visible={type !== null} onClose={onCancel}>
      {/*
        `flexShrink: 1` is what lets the sheet's `maxHeight` actually bite. Without it the
        ScrollView sizes to its content and simply overflows the cap, so a form taller than the
        space left above the keyboard becomes unscrollable rather than scrollable.

        `keyboardShouldPersistTaps="handled"` means the first tap on a date row or the Choose
        photo button registers, instead of being swallowed as a dismiss-the-keyboard tap.
      */}
      <ScrollView
        style={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>{type === null ? '' : documentLabel(type)}</Text>
        <Text style={styles.sub}>
          Add what is printed on the document, then choose a photo. You can leave anything you do
          not have blank.
        </Text>

        {spec.number !== undefined ? (
          <FieldRow label={spec.number.label} icon="hash" focused={focused === 'number'}>
            <TextInput
              value={number}
              onChangeText={setNumber}
              onFocus={() => setFocused('number')}
              onBlur={() => setFocused(null)}
              placeholder={spec.number.placeholder}
              placeholderTextColor={colors.faint}
              keyboardType={spec.number.keyboard}
              // Uppercase suits a licence or policy number; on Aadhaar's numeric pad it does
              // nothing and, on some keyboards, flips the layout to letters for a moment.
              autoCapitalize={spec.number.keyboard === 'number-pad' ? 'none' : 'characters'}
              // The server's own cap (`requestDocumentUploadSchema`: 1–40). Matching it here
              // means a too-long number is stopped at the keystroke rather than at submit.
              maxLength={40}
              style={styles.input}
            />
          </FieldRow>
        ) : null}

        {spec.subType !== undefined ? (
          <FieldRow label={spec.subType.label} boxed={false}>
            <View style={styles.chipRow}>
              {spec.subType.options.map((option) => {
                const selected = subType === option;
                return (
                  <Pressable
                    key={option}
                    // Tapping the selected chip clears it — the driver may have chosen wrongly,
                    // and the field is optional, so there has to be a way back to "unset".
                    onPress={() => setSubType(selected ? null : option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </FieldRow>
        ) : null}

        {spec.issued !== undefined ? (
          <FieldRow label={spec.issued.label} icon="calendar">
            <Pressable onPress={() => setPicking('issued')} accessibilityRole="button">
              <Text style={issuedOn === null ? styles.placeholder : styles.inputText}>
                {issuedOn === null ? 'Select a date' : formatDate(issuedOn)}
              </Text>
            </Pressable>
          </FieldRow>
        ) : null}

        {spec.expires !== undefined ? (
          <FieldRow
            label={spec.expires.label}
            icon="clock"
            hint="(keeps you on duty)"
          >
            <Pressable onPress={() => setPicking('expires')} accessibilityRole="button">
              <Text style={expiresOn === null ? styles.placeholder : styles.inputText}>
                {expiresOn === null ? 'Select a date' : formatDate(expiresOn)}
              </Text>
            </Pressable>
          </FieldRow>
        ) : null}

        <View style={styles.actions}>
          <PrimaryButton label="Choose photo" onPress={handleConfirm} showArrow={false} />
          <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </ScrollView>

      {picking !== null ? (
        <DateTimePicker
          value={(picking === 'issued' ? issuedOn : expiresOn) ?? new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          /*
            An issue date cannot be in the future and an expiry generally is, so the two bounds
            are opposite. Constraining them here is cheaper than a validation message, and stops
            the `expires_on` in the past that the server rejects with "That document has already
            expired" — a round trip the driver does not need to make.
          */
          {...(picking === 'issued' ? { maximumDate: new Date() } : { minimumDate: new Date() })}
          onChange={(event, selected) => {
            // Android fires with type 'dismissed' on cancel and unmounts itself either way.
            setPicking(Platform.OS === 'ios' ? picking : null);
            if (event.type !== 'set' || selected === undefined) return;
            if (picking === 'issued') setIssuedOn(selected);
            else setExpiresOn(selected);
            if (Platform.OS === 'ios') setPicking(null);
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  title: { ...text.heading, color: colors.fg },
  sub: { ...text.body, color: colors.muted, marginTop: space.xs, marginBottom: space.lg },

  input: { ...text.body, color: colors.fg, paddingVertical: space.sm },
  inputText: { ...text.body, color: colors.fg, paddingVertical: space.sm + 3 },
  placeholder: { ...text.body, color: colors.faint, paddingVertical: space.sm + 3 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSunken,
  },
  chipSelected: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipLabel: { ...text.label, color: colors.muted },
  chipLabelSelected: { color: colors.brandOnFg },

  actions: { marginTop: space.md },
  cancel: { alignItems: 'center', paddingVertical: space.md },
  cancelText: { ...text.body, color: colors.muted },
});
