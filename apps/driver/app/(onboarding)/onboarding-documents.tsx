import { Feather } from '@expo/vector-icons';
import type {
  DocumentSide,
  DocumentType,
  DriverDocumentDto,
  RequestDocumentUploadRequest,
} from '@driverzone/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DocumentDetailsSheet } from '@/components/DocumentDetailsSheet';
import { StatusPill } from '@/components/StatusPill';
import {
  describeSubType,
  formatDate,
  hasFields,
  isExpired,
  sideLabel,
  sidesOf,
} from '@/features/onboarding/documentFields';
import {
  ONBOARDING_DOCUMENT_TYPES,
  documentLabel,
  isDocumentRequired,
} from '@/features/onboarding/requirements';
import { uploadFile } from '@/lib/api/client';
import { listDocuments, requestDocumentUpload } from '@/lib/api/endpoints/driver';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

/** The metadata, which is per DOCUMENT — both sides of one licence carry the same. */
type UploadDetails = Omit<RequestDocumentUploadRequest, 'doc_type' | 'side'>;

/** `LICENCE.BACK` — the identity of one uploadable slot, used for every per-slot piece of state. */
type SlotKey = `${DocumentType}.${DocumentSide}`;

function slotKey(type: DocumentType, side: DocumentSide): SlotKey {
  return `${type}.${side}`;
}

/**
 * Document upload. Two steps per file, and the split is deliberate
 * (docs/LLD/user.md §`POST /driver/documents`):
 *
 *   1. `POST /driver/documents` records the row as PENDING and returns a presigned URL
 *   2. the client `PUT`s the bytes STRAIGHT to storage — never through the API
 *
 * Ordering them this way means a transfer killed mid-upload leaves a PENDING row the driver can
 * retry, rather than no record that they ever tried. The cost is that an admin can meet an empty
 * document and reject it — which is the correct outcome and needs no extra machinery.
 *
 * **A document is now SIDES, not one file (2026-09-04).** A licence and a government id are a
 * front and a back, uploaded and reviewed independently — so each card below holds one slot per
 * side, and each slot carries its own status, its own rejection reason and its own retry. The
 * metadata is asked once for the document and sent with both sides: a driver re-typing their
 * licence number to photograph the back is a driver who stops halfway.
 *
 * In development the server hands back a `StubDocumentStorage` URL. It refuses to run in
 * production, so the flow is exercisable end to end now and the real bucket swaps in later
 * without this screen changing.
 */
export default function OnboardingDocumentsScreen(): ReactElement {
  const queryClient = useQueryClient();
  const [busySlot, setBusySlot] = useState<SlotKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which document's details sheet is open, and which slot the driver was aiming for. */
  const [detailsFor, setDetailsFor] = useState<{ type: DocumentType; side: DocumentSide } | null>(
    null,
  );

  /**
   * Slots whose byte transfer failed in THIS session.
   *
   * It exists because the server's row and the file are created at different moments, and only
   * the first is guaranteed. `requestUpload` runs `upsert()` and returns a PENDING row *before*
   * the client has sent a single byte, so a transfer that then fails leaves a row that looks
   * exactly like a successful one — same `PENDING`, same everything. The DTO carries nothing
   * that distinguishes "uploaded, awaiting review" from "row exists, file never arrived".
   *
   * Without this set the screen has only two options, and both are wrong: leave the list stale
   * (what it did — hence "shows an error, but after a refresh it says submitted"), or refetch
   * and render the row as "Awaiting review", which tells the driver they are done when an admin
   * will later open an empty document.
   *
   * Session-scoped on purpose. It is a warning about something that just happened in front of
   * the driver, not a durable fact — the server is the only authority on what is actually
   * stored, and a relaunch correctly defers to it.
   */
  const [failedUploads, setFailedUploads] = useState<ReadonlySet<SlotKey>>(new Set());

  const documents = useQuery({ queryKey: keys.documents.list(), queryFn: listDocuments });

  const upload = useMutation({
    mutationFn: async ({
      type,
      side,
      uri,
      mimeType,
      details,
    }: {
      type: DocumentType;
      side: DocumentSide;
      uri: string;
      mimeType: string;
      details: UploadDetails;
    }) => {
      // The metadata rides on the SAME call that mints the URL — `requestUpload` upserts the row
      // with it, so there is no second request and no window where a document exists without its
      // expiry date.
      const ticket = await requestDocumentUpload({ doc_type: type, side, ...details });
      // `upload_fields` decides POST-multipart vs PUT — the provider's choice, not ours. See the
      // contract note on `RequestDocumentUploadResponse`.
      await uploadFile(ticket.upload_url, uri, mimeType, ticket.upload_fields);
    },
    onMutate: ({ type, side }) => {
      setBusySlot(slotKey(type, side));
      setError(null);
      // Clear any previous failure for this slot — a retry starts clean, and leaving the old
      // warning up through a successful re-upload would be its own kind of lie.
      setFailedUploads((current) => without(current, slotKey(type, side)));
    },
    onSuccess: (_result, { type, side }) => {
      setFailedUploads((current) => without(current, slotKey(type, side)));
    },
    onError: (cause, { type, side }) => {
      setFailedUploads((current) => new Set(current).add(slotKey(type, side)));
      setError(cause instanceof Error ? cause.message : 'The upload did not complete.');
    },
    /**
     * Refetch on SETTLED, not just on success.
     *
     * The row exists either way, so hiding it on failure is what made the screen disagree with
     * the server until the driver pulled a refresh. Showing it — flagged via `failedUploads`
     * above — keeps the two in step without overstating what actually got stored.
     */
    onSettled: async () => {
      setBusySlot(null);
      await queryClient.invalidateQueries({ queryKey: keys.documents.all() });
    },
  });

  const bySlot = new Map<SlotKey, DriverDocumentDto>();
  for (const doc of documents.data ?? []) bySlot.set(slotKey(doc.doc_type, doc.side), doc);

  /**
   * The details already on file for a type, read off whichever side was uploaded first.
   *
   * This is what makes the second side one tap. `upsert` writes the metadata it is given, so
   * sending the back with an empty payload would blank the licence number captured with the
   * front — the fields are per-document even though the rows are per-side.
   */
  function detailsOnFile(type: DocumentType): UploadDetails | null {
    const existing = sidesOf(type)
      .map((side) => bySlot.get(slotKey(type, side)))
      .find((doc): doc is DriverDocumentDto => doc !== undefined);
    if (existing === undefined) return null;

    const details: UploadDetails = {};
    if (existing.number !== null) details.number = existing.number;
    if (existing.sub_type !== null) details.sub_type = existing.sub_type;
    if (existing.issued_on !== null) details.issued_on = existing.issued_on;
    if (existing.expires_on !== null) details.expires_on = existing.expires_on;
    return details;
  }

  /**
   * Tapping a slot opens the details sheet only when there is nothing on file yet — a type with
   * no fields, or a second side whose details were captured with the first, goes straight to the
   * gallery rather than showing a form the driver has already filled in.
   */
  function beginUpload(type: DocumentType, side: DocumentSide): void {
    setError(null);

    const onFile = detailsOnFile(type);
    if (onFile !== null) {
      void pickAndUpload(type, side, onFile);
      return;
    }
    if (hasFields(type)) {
      setDetailsFor({ type, side });
      return;
    }
    void pickAndUpload(type, side, {});
  }

  async function pickAndUpload(
    type: DocumentType,
    side: DocumentSide,
    details: UploadDetails,
  ): Promise<void> {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('DriverZone needs access to your photos to upload a document.');
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // A photo of a licence has to be legible to an admin, so quality matters more than bytes —
      // but a modern phone's full-resolution JPEG is ~8MB on a metered connection, which is the
      // other way to fail. 0.7 is the compromise that stays readable.
      quality: 0.7,
      allowsEditing: false,
    });

    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (asset === undefined) return;

    upload.mutate({
      type,
      side,
      uri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      details,
    });
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Your documents</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Photograph both sides of your licence and ID, clearly and in good light. An admin checks
          them before you can go on duty.
        </Text>

        {error !== null ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        {documents.isPending ? (
          <ActivityIndicator size="large" color={colors.fg} style={styles.loading} />
        ) : (
          ONBOARDING_DOCUMENT_TYPES.map((type) => (
            <DocumentCard
              key={type}
              type={type}
              bySlot={bySlot}
              busySlot={busySlot}
              failedUploads={failedUploads}
              onPressSide={(side) => beginUpload(type, side)}
              onEditDetails={() => {
                setError(null);
                setDetailsFor({ type, side: 'FRONT' });
              }}
            />
          ))
        )}
      </ScrollView>

      <DocumentDetailsSheet
        type={detailsFor?.type ?? null}
        onCancel={() => setDetailsFor(null)}
        onConfirm={(details) => {
          const target = detailsFor;
          setDetailsFor(null);
          // The gallery opens after the sheet has dismissed. Launching the picker while a modal
          // is still on screen leaves the two fighting over the window on Android, and the picker
          // can come back to a screen that is mid-animation.
          if (target !== null) void pickAndUpload(target.type, target.side, details);
        }}
      />
    </View>
  );
}

function without(current: ReadonlySet<SlotKey>, key: SlotKey): ReadonlySet<SlotKey> {
  if (!current.has(key)) return current;
  const next = new Set(current);
  next.delete(key);
  return next;
}

/**
 * One document: its metadata, and a slot per side.
 *
 * A CARD rather than a row, because a two-sided document has two independent states to show and a
 * single line cannot say "front verified, back rejected" — which is exactly the case per-side
 * review exists to produce.
 */
function DocumentCard({
  type,
  bySlot,
  busySlot,
  failedUploads,
  onPressSide,
  onEditDetails,
}: {
  type: DocumentType;
  bySlot: ReadonlyMap<SlotKey, DriverDocumentDto>;
  busySlot: SlotKey | null;
  failedUploads: ReadonlySet<SlotKey>;
  onPressSide: (side: DocumentSide) => void;
  onEditDetails: () => void;
}): ReactElement {
  const required = isDocumentRequired(type);
  const sides = sidesOf(type);
  const anyUploaded = sides.some((side) => bySlot.has(slotKey(type, side)));
  // Read off whichever side exists — the metadata belongs to the document, not to a face of it.
  const meta = sides
    .map((side) => bySlot.get(slotKey(type, side)))
    .find((doc): doc is DriverDocumentDto => doc !== undefined);

  const summary =
    meta === undefined
      ? null
      : [
          meta.sub_type === null ? null : describeSubType(type, meta.sub_type),
          meta.number,
          meta.issued_on === null ? null : `issued ${formatDate(new Date(meta.issued_on))}`,
          meta.expires_on === null
            ? null
            : `valid to ${formatDate(new Date(meta.expires_on))}`,
        ]
          .filter((part): part is string => part !== null && part !== '')
          .join(' · ');

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadText}>
          <Text style={styles.cardTitle}>
            {documentLabel(type)}
            {required ? <Text style={styles.requiredMark}> *</Text> : null}
          </Text>
          <Text style={styles.cardHint}>
            {required ? 'Required' : 'Optional'}
            {sides.length > 1 ? ' · both sides' : ''}
          </Text>
        </View>

        {/* Only once something exists to attach details to — an edit button on an empty card
            would open a form whose Save has nothing to save against. */}
        {anyUploaded && hasFields(type) ? (
          <Pressable
            onPress={onEditDetails}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Edit ${documentLabel(type)} details`}
            style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
          >
            <Feather name="edit-2" size={14} color={colors.fg} />
          </Pressable>
        ) : null}
      </View>

      {summary !== null && summary !== '' ? <Text style={styles.summary}>{summary}</Text> : null}

      {/*
        An expiry already in the past outranks every review status on the card. `prd.md` FR-D6
        blocks duty on expired documents, so a driver whose licence lapsed needs to see it here
        rather than discovering it as a 409 the next time they try to go online.
      */}
      {meta !== undefined && isExpired(meta.expires_on) ? (
        <View style={styles.expiredRow}>
          <StatusPill label="Expired" tone="danger" />
        </View>
      ) : null}

      <View style={styles.slotRow}>
        {sides.map((side) => (
          <SideSlot
            key={side}
            side={side}
            document={bySlot.get(slotKey(type, side))}
            busy={busySlot === slotKey(type, side)}
            uploadFailed={failedUploads.has(slotKey(type, side))}
            wide={sides.length === 1}
            onPress={() => onPressSide(side)}
          />
        ))}
      </View>
    </View>
  );
}

/** One face: a thumbnail once it exists, its own status, and its own retry. */
function SideSlot({
  side,
  document,
  busy,
  uploadFailed,
  wide,
  onPress,
}: {
  side: DocumentSide;
  document: DriverDocumentDto | undefined;
  busy: boolean;
  /** The byte transfer failed this session — the row exists, the file almost certainly does not. */
  uploadFailed: boolean;
  wide: boolean;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Upload ${sideLabel(side)}`}
      style={({ pressed }) => [
        styles.slot,
        wide && styles.slotWide,
        pressed && !busy && styles.pressed,
      ]}
    >
      <View style={styles.thumb}>
        {busy ? (
          <ActivityIndicator size="small" color={colors.fg} />
        ) : document !== undefined && !uploadFailed ? (
          /*
            The presigned URL the server minted, shown as a thumbnail. It expires in minutes,
            which is fine for a screen that is looked at now and refetched on every focus — and a
            driver seeing their own photo is the only real confirmation that the right one went up.
          */
          <Image source={{ uri: document.url }} style={styles.thumbImage} resizeMode="cover" />
        ) : (
          <Feather
            name={uploadFailed ? 'alert-triangle' : 'camera'}
            size={20}
            color={uploadFailed ? colors.danger : colors.faint}
          />
        )}
      </View>

      <Text style={styles.slotLabel}>{sideLabel(side)}</Text>

      {uploadFailed ? (
        /*
          The row exists on the server but the photo did not reach storage. Saying "Awaiting
          review" here would be the dangerous reading — the driver stops, submits, and an admin
          opens an empty document. So this case outranks the server's PENDING.
        */
        <>
          <StatusPill label="Not uploaded" tone="danger" />
          <Text style={styles.slotNote}>Tap to choose again.</Text>
        </>
      ) : document === undefined ? (
        <Text style={styles.slotNote}>Not uploaded</Text>
      ) : (
        <>
          <StatusPill label={STATUS_LABELS[document.status]} tone={STATUS_TONES[document.status]} />
          {/*
            The admin's reason, verbatim, on the side it belongs to. `user.md` makes `reason`
            mandatory on a rejection precisely so this line can exist — and pinning it to the face
            that was rejected is what stops the driver retaking both.
          */}
          {document.status === 'REJECTED' && document.rejection_reason !== null ? (
            <Text style={styles.slotRejection}>{document.rejection_reason}</Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}

const STATUS_LABELS = {
  PENDING: 'Awaiting review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
} as const;

const STATUS_TONES = {
  PENDING: 'pending',
  VERIFIED: 'success',
  REJECTED: 'danger',
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pressed: { opacity: 0.85 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brand,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  headerTitle: { ...text.heading, color: colors.fg },
  headerSpacer: { width: 22 },

  scroll: { padding: space.lg },
  intro: { ...text.body, color: colors.muted, marginBottom: space.lg },
  error: { ...text.caption, color: colors.danger, marginBottom: space.md },
  loading: { marginTop: space.xl },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start' },
  cardHeadText: { flex: 1 },
  cardTitle: { ...text.body, color: colors.fg },
  requiredMark: { color: colors.danger },
  cardHint: { ...text.caption, color: colors.muted, marginTop: 1 },
  editButton: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
  },

  summary: { ...text.caption, color: colors.muted, marginTop: space.xs },
  expiredRow: { flexDirection: 'row', marginTop: space.xs },

  slotRow: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  slot: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  /** A single-sided document gets a wider, shorter slot — two halves with nothing in the second
      would read as a missing upload rather than a document that has only one face. */
  slotWide: { flexDirection: 'row', justifyContent: 'flex-start', gap: space.sm },
  thumb: {
    width: 64,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImage: { width: '100%', height: '100%' },
  slotLabel: { ...text.label, color: colors.fg },
  slotNote: { ...text.caption, color: colors.muted, textAlign: 'center' },
  slotRejection: { ...text.caption, color: colors.danger, textAlign: 'center' },
});
