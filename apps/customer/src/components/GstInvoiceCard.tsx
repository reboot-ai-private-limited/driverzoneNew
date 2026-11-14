import { Feather } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  gstStateOf,
  type CreateGstInvoiceRequest,
  type GstBillingDetailsDto,
  type GstInvoiceRequestDto,
} from '@driverzone/contracts';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { BottomSheet } from '@/components/BottomSheet';
import { PrimaryButton } from '@/components/PrimaryButton';
import { isValidIndianMobile, normaliseInput, toE164 } from '@/features/auth/phoneNumber';
import { getGstInvoice, requestGstInvoice } from '@/lib/api/endpoints/bookings';
import { getProfile } from '@/lib/api/endpoints/customer';
import { keys } from '@/lib/query/keys';
import { colors, fontFamily, radius, space, text } from '@/theme/theme';

/** The promise the customer is given — on the form, and again once the request is in. */
const TURNAROUND =
  'We have received your request. Your GST invoice will be generated and sent to you within the next working days.';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What every field on the form shares. `underlineColorAndroid` matters: without it Android draws
 * its own black underline inside the rounded box, which is what made the first version look broken.
 * No autocorrect — GSTINs, legal names and addresses are not words to be "fixed".
 */
const INPUT = {
  placeholderTextColor: colors.faint,
  underlineColorAndroid: 'transparent',
  autoCorrect: false,
  spellCheck: false,
} as const;

interface Draft {
  gstin: string;
  legalName: string;
  billingAddress: string;
  pincode: string;
  /** The bare 10-digit national number, as the login screen keeps it. */
  whatsapp: string;
  email: string;
}

function draftFrom(prefill: GstBillingDetailsDto | null, ownNumber: string | undefined): Draft {
  const whatsapp = prefill?.send_to_whatsapp ?? ownNumber ?? '';
  return {
    gstin: prefill?.gstin ?? '',
    legalName: prefill?.legal_name ?? '',
    billingAddress: prefill?.billing_address ?? '',
    pincode: prefill?.pincode ?? '',
    whatsapp: normaliseInput(whatsapp),
    email: prefill?.send_to_email ?? '',
  };
}

/** The first thing wrong with the form, in the order it reads — or null when it can be sent. */
function problemOf(draft: Draft): string | null {
  if (gstStateOf(draft.gstin) === null) return 'Enter a valid 15-character GSTIN.';
  if (draft.legalName.trim() === '') return 'Enter the business or legal name.';
  if (draft.billingAddress.trim().length < 5) return 'Enter the billing address.';
  if (!/^[1-9]\d{5}$/.test(draft.pincode.trim())) return 'Enter a 6-digit pincode.';
  const hasWhatsapp = draft.whatsapp !== '';
  const hasEmail = draft.email.trim() !== '';
  if (!hasWhatsapp && !hasEmail) return 'Add a WhatsApp number or an email to send the bill to.';
  if (hasWhatsapp && !isValidIndianMobile(draft.whatsapp)) return 'Enter a 10-digit WhatsApp number.';
  if (hasEmail && !EMAIL.test(draft.email.trim())) return 'Enter a valid email address.';
  return null;
}

function toRequest(draft: Draft): CreateGstInvoiceRequest {
  return {
    gstin: draft.gstin.trim().toUpperCase(),
    legal_name: draft.legalName.trim(),
    billing_address: draft.billingAddress.trim(),
    pincode: draft.pincode.trim(),
    ...(draft.whatsapp === '' ? {} : { send_to_whatsapp: toE164(draft.whatsapp) }),
    ...(draft.email.trim() === '' ? {} : { send_to_email: draft.email.trim() }),
  };
}

/**
 * GST INVOICE — on a completed trip's ride details (2026-10-28).
 *
 * No separate page: an invoice is always for ONE trip, so the request lives on that trip. The form
 * is a sheet over this screen, pre-filled from the customer's last request so a business that
 * books often types its details once. Once sent, the card shows where the request is.
 */
export function GstInvoiceCard({ bookingId }: { bookingId: string }): ReactElement {
  const invoice = useQuery({
    queryKey: keys.bookings.gstInvoice(bookingId),
    queryFn: ({ signal }) => getGstInvoice(bookingId, signal),
  });
  const profile = useQuery({ queryKey: keys.profile.me(), queryFn: getProfile });
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <Feather name="file-text" size={15} color={colors.fg} />
        <Text style={styles.title}>GST invoice</Text>
      </View>

      {invoice.isPending ? (
        <ActivityIndicator color={colors.muted} style={styles.loading} />
      ) : invoice.isError ? (
        <Pressable onPress={() => void invoice.refetch()} accessibilityRole="button">
          <Text style={styles.body}>Could not check for a GST invoice. Tap to try again.</Text>
        </Pressable>
      ) : invoice.data.request === null ? (
        <>
          <Text style={styles.body}>Need a GST bill for this trip? Send us your business details.</Text>
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.requestButton, pressed && styles.pressed]}
          >
            <Text style={styles.requestButtonText}>Request GST invoice</Text>
            <Feather name="chevron-right" size={16} color={colors.fg} />
          </Pressable>
          <GstInvoiceSheet
            visible={open}
            onClose={() => setOpen(false)}
            bookingId={bookingId}
            initial={draftFrom(invoice.data.prefill, profile.data?.mobile_number)}
          />
        </>
      ) : (
        <RequestStatus request={invoice.data.request} />
      )}
    </View>
  );
}

function RequestStatus({ request }: { request: GstInvoiceRequestDto }): ReactElement {
  const sentTo = [request.send_to_whatsapp, request.send_to_email].filter((v): v is string => v !== null);
  return (
    <>
      <View
        style={[
          styles.chip,
          request.status === 'SENT' && styles.chipSent,
          request.status === 'REJECTED' && styles.chipRejected,
        ]}
      >
        <Text style={styles.chipText}>
          {request.status === 'PENDING' ? 'Requested' : request.status === 'SENT' ? 'Sent' : 'Not issued'}
        </Text>
      </View>
      <Text style={styles.body}>
        {request.status === 'PENDING'
          ? TURNAROUND
          : request.status === 'SENT'
            ? `Your GST invoice${request.invoice_number === null ? '' : ` (${request.invoice_number})`} has been sent.`
            : 'We could not issue a GST invoice for this request.'}
      </Text>
      {request.admin_note === null ? null : <Text style={styles.note}>{request.admin_note}</Text>}
      <Text style={styles.meta}>
        {request.legal_name} · {request.gstin}
      </Text>
      {sentTo.length === 0 ? null : <Text style={styles.meta}>Sent to {sentTo.join(' · ')}</Text>}
    </>
  );
}

function GstInvoiceSheet({
  visible,
  onClose,
  bookingId,
  initial,
}: {
  visible: boolean;
  onClose: () => void;
  bookingId: string;
  initial: Draft;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>(initial);
  const [touched, setTouched] = useState(false);
  /*
   * A FRESH FORM EACH TIME IT OPENS, from the pre-fill as it stands now. The sheet is mounted
   * before the profile has necessarily loaded, so the first `initial` can be missing the
   * customer's own number.
   */
  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setTouched(false);
    // `initial` is rebuilt every render; opening the sheet is the event that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const queryClient = useQueryClient();
  const { height } = useWindowDimensions();

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const problem = problemOf(draft);
  const state = gstStateOf(draft.gstin);

  const submit = useMutation({
    mutationFn: () => requestGstInvoice(bookingId, toRequest(draft)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.bookings.gstInvoice(bookingId) });
      onClose();
    },
  });

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.sheetHead}>
        <View style={styles.flex}>
          <Text style={styles.sheetTitle}>Request GST invoice</Text>
          <Text style={styles.sheetSubtitle}>We make the bill out to these details.</Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Feather name="x" size={18} color={colors.fg} />
        </Pressable>
      </View>

      <ScrollView
        style={{ maxHeight: Math.max(320, height * 0.62) }}
        contentContainerStyle={styles.sheetContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Business details ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business details</Text>

          <Field label="GSTIN">
            <TextInput
              {...INPUT}
              value={draft.gstin}
              onChangeText={(gstin) => set({ gstin: gstin.toUpperCase().replace(/\s/g, '') })}
              placeholder="e.g. 19ABCDE1234F1Z5"
              autoCapitalize="characters"
              maxLength={15}
              style={[styles.input, styles.mono]}
              accessibilityLabel="GSTIN"
            />
          </Field>

          <Field label="Business / legal name">
            <TextInput
              {...INPUT}
              value={draft.legalName}
              onChangeText={(legalName) => set({ legalName })}
              placeholder="As registered for GST"
              autoCapitalize="words"
              maxLength={120}
              style={styles.input}
              accessibilityLabel="Business or legal name"
            />
          </Field>

          <Field label="Billing address">
            <TextInput
              {...INPUT}
              value={draft.billingAddress}
              onChangeText={(billingAddress) => set({ billingAddress })}
              placeholder="Building, street, city"
              multiline
              maxLength={500}
              style={[styles.input, styles.multiline]}
              accessibilityLabel="Billing address"
            />
          </Field>

          {/* Pincode beside the state — the state is read off the GSTIN, never typed. */}
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label="Pincode">
                <TextInput
                  {...INPUT}
                  value={draft.pincode}
                  onChangeText={(pincode) => set({ pincode: pincode.replace(/\D/g, '').slice(0, 6) })}
                  placeholder="734001"
                  keyboardType="number-pad"
                  maxLength={6}
                  style={styles.input}
                  accessibilityLabel="Pincode"
                />
              </Field>
            </View>
            <View style={styles.flex}>
              <Field label="State">
                <View style={[styles.input, styles.readOnly]}>
                  <Text
                    style={state === null ? styles.readOnlyEmpty : styles.readOnlyText}
                    numberOfLines={1}
                  >
                    {state ?? 'From GSTIN'}
                  </Text>
                </View>
              </Field>
            </View>
          </View>
        </View>

        {/* ── Send GST bill to ───────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Send GST bill to</Text>
          <Text style={styles.sectionHint}>WhatsApp number or email — at least one is required.</Text>

          <Field label="WhatsApp number">
            <View style={styles.phoneRow}>
              <Text style={styles.dialCode}>+91</Text>
              <View style={styles.dialDivider} />
              <TextInput
                {...INPUT}
                value={draft.whatsapp}
                onChangeText={(raw) => set({ whatsapp: normaliseInput(raw) })}
                placeholder="10-digit number"
                keyboardType="phone-pad"
                maxLength={10}
                style={styles.phoneInput}
                accessibilityLabel="WhatsApp number"
              />
            </View>
          </Field>

          <Field label="Email">
            <TextInput
              {...INPUT}
              value={draft.email}
              onChangeText={(email) => set({ email })}
              placeholder="accounts@yourcompany.com"
              keyboardType="email-address"
              autoCapitalize="none"
              maxLength={120}
              style={styles.input}
              accessibilityLabel="Email"
            />
          </Field>
        </View>

        <View style={styles.notice}>
          <Feather name="clock" size={14} color={colors.muted} />
          <Text style={styles.noticeText}>
            We send your generated GST invoice within the next working days.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.buttonGap} />
      <PrimaryButton
        label="Request GST invoice"
        onPress={() => {
          setTouched(true);
          if (problem === null) submit.mutate();
        }}
        loading={submit.isPending}
        showArrow={false}
      />
      {(touched && problem !== null) || submit.isError ? (
        <Text style={styles.error}>
          {problem ?? (submit.error instanceof Error ? submit.error.message : 'Could not send your request.')}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    // Same box as the ride screen's `SectionCard`s around it: gap BELOW, not above, so it keeps
    // clear air from the next card instead of touching it.
    padding: space.lg,
    marginBottom: space.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginBottom: space.xs },
  title: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  loading: { marginVertical: space.sm },
  body: { ...text.caption, color: colors.muted, marginTop: space.xs, lineHeight: 18 },
  note: { ...text.caption, color: colors.fg, marginTop: space.xs },
  meta: { ...text.caption, color: colors.faint, marginTop: space.xs },
  pressed: { opacity: 0.6 },

  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  requestButtonText: { ...text.label, color: colors.fg, fontFamily: fontFamily.semibold },

  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    marginTop: space.xs,
  },
  chipSent: { backgroundColor: '#E6F4EA' },
  chipRejected: { backgroundColor: '#FDECEC' },
  chipText: { ...text.caption, color: colors.fg, fontFamily: fontFamily.semibold },

  flex: { flex: 1 },

  // ── The sheet ──────────────────────────────────────────────────────────────
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.md },
  sheetTitle: { ...text.heading, color: colors.fg },
  sheetSubtitle: { ...text.caption, color: colors.muted, marginTop: 2 },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSunken,
  },
  sheetContent: { gap: space.md, paddingBottom: space.xs },

  /** One group of fields on a sunken panel, so "who to bill" and "where to send it" read apart. */
  section: {
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  sectionTitle: { ...text.label, color: colors.fg, fontFamily: fontFamily.bold },
  sectionHint: { ...text.caption, color: colors.muted, marginTop: -space.xs },

  field: { gap: 6 },
  label: { ...text.caption, color: colors.muted, fontFamily: fontFamily.semibold },
  input: {
    ...text.body,
    color: colors.fg,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 46,
    paddingVertical: 10,
  },
  mono: { letterSpacing: 1, fontFamily: fontFamily.semibold },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: space.sm },
  readOnly: { justifyContent: 'center', backgroundColor: colors.bgSunken },
  readOnlyText: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  readOnlyEmpty: { ...text.body, color: colors.faint },

  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 46,
  },
  dialCode: { ...text.body, color: colors.fg, fontFamily: fontFamily.semibold },
  dialDivider: { width: 1, alignSelf: 'stretch', marginVertical: 10, marginHorizontal: space.sm, backgroundColor: colors.border },
  phoneInput: { ...text.body, color: colors.fg, flex: 1, paddingVertical: 10 },

  notice: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.sm,
  },
  noticeText: { ...text.caption, color: colors.muted, flex: 1 },

  /** Clear air between the last field and the button, so nothing reads as hidden behind it. */
  buttonGap: { height: space.md },
  error: { ...text.caption, color: colors.danger, textAlign: 'center', marginTop: space.sm },
});
