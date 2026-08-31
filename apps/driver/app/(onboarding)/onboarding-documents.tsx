import { Feather } from '@expo/vector-icons';
import type {
  DocumentType,
  DriverDocumentDto,
  RequestDocumentUploadRequest,
} from '@driverzone/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { type ReactElement, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { DocumentDetailsSheet } from '@/components/DocumentDetailsSheet';
import { StatusPill } from '@/components/StatusPill';
import { formatDate, hasFields, isExpired } from '@/features/onboarding/documentFields';
import {
  ONBOARDING_DOCUMENT_TYPES,
  documentLabel,
  isDocumentRequired,
} from '@/features/onboarding/requirements';
import { uploadFile } from '@/lib/api/client';
import { listDocuments, requestDocumentUpload } from '@/lib/api/endpoints/driver';
import { keys } from '@/lib/query/keys';
import { colors, radius, space, text } from '@/theme/theme';

type UploadDetails = Omit<RequestDocumentUploadRequest, 'doc_type'>;

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
 * In development the server hands back a `StubDocumentStorage` URL. It refuses to run in
 * production, so the flow is exercisable end to end now and the real bucket swaps in later
 * without this screen changing.
 */
export default function OnboardingDocumentsScreen(): ReactElement {
  const queryClient = useQueryClient();
  const [busyType, setBusyType] = useState<DocumentType | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Which document's details sheet is open. `null` closes it. */
  const [detailsFor, setDetailsFor] = useState<DocumentType | null>(null);

  /**
   * Document types whose byte transfer failed in THIS session.
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
   * will later open an empty document. `documentStorage.stub.ts` names that second failure
   * exactly: it "would look like it worked, and the failure would surface weeks later".
   *
   * Session-scoped on purpose. It is a warning about something that just happened in front of
   * the driver, not a durable fact — the server is the only authority on what is actually
   * stored, and a relaunch correctly defers to it.
   */
  const [failedUploads, setFailedUploads] = useState<ReadonlySet<DocumentType>>(new Set());

  const documents = useQuery({ queryKey: keys.documents.list(), queryFn: listDocuments });

  const upload = useMutation({
    mutationFn: async ({
      type,
      uri,
      mimeType,
      details,
    }: {
      type: DocumentType;
      uri: string;
      mimeType: string;
      details: UploadDetails;
    }) => {
      // The metadata rides on the SAME call that mints the URL — `requestUpload` upserts the row
      // with it, so there is no second request and no window where a document exists without its
      // expiry date.
      const ticket = await requestDocumentUpload({ doc_type: type, ...details });
      // `upload_fields` decides POST-multipart vs PUT — the provider's choice, not ours. See the
      // contract note on `RequestDocumentUploadResponse`.
      await uploadFile(ticket.upload_url, uri, mimeType, ticket.upload_fields);
    },
    onMutate: ({ type }) => {
      setBusyType(type);
      setError(null);
      // Clear any previous failure for this type — a retry starts clean, and leaving the old
      // warning up through a successful re-upload would be its own kind of lie.
      setFailedUploads((current) => {
        if (!current.has(type)) return current;
        const next = new Set(current);
        next.delete(type);
        return next;
      });
    },
    onSuccess: (_result, { type }) => {
      setFailedUploads((current) => {
        if (!current.has(type)) return current;
        const next = new Set(current);
        next.delete(type);
        return next;
      });
    },
    onError: (cause, { type }) => {
      setFailedUploads((current) => new Set(current).add(type));
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
      setBusyType(null);
      await queryClient.invalidateQueries({ queryKey: keys.documents.all() });
    },
  });

  /**
   * Tapping a document opens its details sheet first — except for a type that has nothing to
   * ask, which goes straight to the gallery rather than showing an empty form.
   */
  function beginUpload(type: DocumentType): void {
    setError(null);
    if (hasFields(type)) {
      setDetailsFor(type);
      return;
    }
    void pickAndUpload(type, {});
  }

  async function pickAndUpload(type: DocumentType, details: UploadDetails): Promise<void> {
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

    upload.mutate({ type, uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg', details });
  }

  const byType = new Map<DocumentType, DriverDocumentDto>();
  for (const doc of documents.data ?? []) byType.set(doc.doc_type, doc);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={22} color={colors.fg} />
        </Pressable>
        <Text style={styles.headerTitle}>Your documents</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Upload a clear photo of each document. An admin checks them before you can go on duty.
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
            <DocumentRow
              key={type}
              type={type}
              document={byType.get(type)}
              busy={busyType === type}
              uploadFailed={failedUploads.has(type)}
              onPress={() => beginUpload(type)}
            />
          ))
        )}
      </ScrollView>

      <DocumentDetailsSheet
        type={detailsFor}
        onCancel={() => setDetailsFor(null)}
        onConfirm={(details) => {
          const type = detailsFor;
          setDetailsFor(null);
          // The gallery opens after the sheet has dismissed. Launching the picker while a modal
          // is still on screen leaves the two fighting over the window on Android, and the picker
          // can come back to a screen that is mid-animation.
          if (type !== null) void pickAndUpload(type, details);
        }}
      />
    </View>
  );
}

function DocumentRow({
  type,
  document,
  busy,
  uploadFailed,
  onPress,
}: {
  type: DocumentType;
  document: DriverDocumentDto | undefined;
  busy: boolean;
  /** The byte transfer failed this session — the row exists, the file almost certainly does not. */
  uploadFailed: boolean;
  onPress: () => void;
}): ReactElement {
  const required = isDocumentRequired(type);

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={`Upload ${documentLabel(type)}`}
      style={({ pressed }) => [styles.row, pressed && !busy && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <Feather name="file-text" size={20} color={colors.muted} />
      </View>

      <View style={styles.rowBody}>
        <Text style={styles.rowLabel}>
          {documentLabel(type)}
          {required ? <Text style={styles.requiredMark}> *</Text> : null}
        </Text>

        {uploadFailed ? (
          /*
            The row exists on the server but the photo did not reach storage. Saying "Awaiting
            review" here would be the dangerous reading — the driver stops, submits, and an admin
            opens an empty document. So this case outranks the server's PENDING and asks for the
            one thing that actually fixes it.
          */
          <>
            <StatusPill label="Photo not uploaded" tone="danger" />
            <Text style={styles.rejectionReason}>Tap to choose the photo again.</Text>
          </>
        ) : document === undefined ? (
          <Text style={styles.rowHint}>{required ? 'Required' : 'Optional'} · not uploaded</Text>
        ) : (
          <>
            <View style={styles.pillRow}>
              <StatusPill
                label={STATUS_LABELS[document.status]}
                tone={STATUS_TONES[document.status]}
              />
              {/*
                An expiry already in the past outranks the review status. `prd.md` FR-D6 blocks
                duty on expired documents, so a driver whose licence lapsed needs to see that
                here rather than discovering it as a 409 the next time they try to go online.
              */}
              {isExpired(document.expires_on) ? (
                <StatusPill label="Expired" tone="danger" />
              ) : null}
            </View>

            {/* What was captured, so the driver can tell a wrong number from a missing one. */}
            <Text style={styles.rowMeta}>
              {[
                document.number,
                document.sub_type,
                document.expires_on === null
                  ? null
                  : `valid to ${formatDate(new Date(document.expires_on))}`,
              ]
                .filter((part): part is string => part !== null && part !== '')
                .join(' · ')}
            </Text>

            {/*
              The admin's reason, verbatim. `user.md` makes `reason` mandatory on a rejection
              precisely so this line can exist — a driver told only "rejected" has nothing to act
              on and re-uploads the same unreadable photo.
            */}
            {document.status === 'REJECTED' && document.rejection_reason !== null ? (
              <Text style={styles.rejectionReason}>{document.rejection_reason}</Text>
            ) : null}
          </>
        )}
      </View>

      {busy ? (
        <ActivityIndicator size="small" color={colors.fg} />
      ) : (
        <Feather
          name={document === undefined ? 'upload' : 'refresh-cw'}
          size={18}
          color={colors.faint}
        />
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

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
  },
  rowPressed: { backgroundColor: colors.bgSunken },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: space.md,
  },
  rowBody: { flex: 1, gap: 4 },
  rowLabel: { ...text.body, color: colors.fg },
  requiredMark: { color: colors.danger },
  rowHint: { ...text.caption, color: colors.muted },
  rowMeta: { ...text.caption, color: colors.muted },
  pillRow: { flexDirection: 'row', gap: space.xs, flexWrap: 'wrap' },
  rejectionReason: { ...text.caption, color: colors.danger },
});
