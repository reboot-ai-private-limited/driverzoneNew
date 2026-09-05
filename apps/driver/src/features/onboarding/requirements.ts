import type { DocumentType, DriverDocumentDto, DriverProfileDto } from '@driverzone/contracts';

/**
 * The client's view of the submission gate in
 * apps/api/src/modules/identity/domain/driverOnboarding.entity.ts.
 *
 * **The server is the authority, and this is not a second implementation of the rule.** The
 * server's `missingForSubmission` decides, and its list comes back on the 400 from
 * `POST /driver/onboarding/submit`. What this file does is (a) let the UI disable the Submit
 * button and show progress *before* a round-trip, and (b) turn the server's dot-paths into
 * something a driver can read. If the two ever disagree, the server wins — which is why
 * `missingLocally` is only ever used for the optimistic view and the screens still render
 * `ApiError.missingFields` when a submit is rejected.
 */

/**
 * Identity documents required before an admin will look at an application — BOTH SIDES of each,
 * which the server checks per side (`REQUIRED_DOCUMENTS` in `driverOnboarding.entity.ts`).
 *
 * PRESENCE, not verification: an admin verifies content at the next step, and a driver cannot be
 * asked to wait for approval before being allowed to ask for it. `POLICE_VERIFICATION` and
 * `OTHER` are optional — the first is a document many drivers do not hold yet, the second is by
 * definition whatever support happened to ask for.
 */
export const REQUIRED_DOCUMENT_TYPES: readonly DocumentType[] = ['LICENCE', 'GOVERNMENT_ID'];

/** Uploadable in onboarding, required ones first. */
export const ONBOARDING_DOCUMENT_TYPES: readonly DocumentType[] = [
  'LICENCE',
  'GOVERNMENT_ID',
  'POLICE_VERIFICATION',
  'OTHER',
];

/** The profile fields an admin needs in order to make a decision at all. */
export const REQUIRED_PROFILE_FIELDS = ['full_name', 'dob', 'gender', 'address'] as const;

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  LICENCE: 'Driving licence',
  GOVERNMENT_ID: 'Government ID',
  POLICE_VERIFICATION: 'Police verification',
  OTHER: 'Other document',
};

const FIELD_LABELS: Record<string, string> = {
  full_name: 'Full name',
  dob: 'Date of birth',
  gender: 'Gender',
  address: 'Address',
};

export function documentLabel(type: DocumentType): string {
  return DOCUMENT_LABELS[type];
}

export function isDocumentRequired(type: DocumentType): boolean {
  return REQUIRED_DOCUMENT_TYPES.includes(type);
}

/**
 * `documents.LICENCE.BACK` → `Driving licence (back)`, `dob` → `Date of birth`.
 *
 * THE SIDE IS KEPT IN THE PROSE. The server names a missing face specifically so the driver
 * re-photographs only that one; collapsing it back to "Driving licence" here would throw away the
 * whole reason the path carries it.
 *
 * An unknown path falls back to the raw string rather than being dropped: a requirement added
 * server-side must still show as *something* on a build that predates it. Silently rendering
 * nothing would tell the driver their profile is complete while the server refuses it.
 */
export function describeMissing(path: string): string {
  if (!path.startsWith('documents.')) return FIELD_LABELS[path] ?? path;

  const [type, side] = path.slice('documents.'.length).split('.');
  const label = DOCUMENT_LABELS[type as DocumentType];
  if (label === undefined) return path;

  // A single-sided document arrives with no side segment, and reads better without one.
  return side === undefined ? label : `${label} (${side.toLowerCase()})`;
}

/** Which screen a missing path lives on, so the review screen can send the driver straight there. */
export function screenForMissing(path: string): '/onboarding-profile' | '/onboarding-documents' {
  return path.startsWith('documents.') ? '/onboarding-documents' : '/onboarding-profile';
}

/**
 * The same computation the server does, for the optimistic view only. Mirrors
 * `missingForSubmission` field for field — including the `trim()` on the text fields, because a
 * whitespace-only name satisfies a null check and tells an admin nothing.
 */
export function missingLocally(
  profile: DriverProfileDto | undefined,
  documents: readonly DriverDocumentDto[] | undefined,
): string[] {
  if (profile === undefined || documents === undefined) return [];

  const missing: string[] = [];

  if (profile.full_name === null || profile.full_name.trim() === '') missing.push('full_name');
  if (profile.dob === null) missing.push('dob');
  if (profile.gender === null) missing.push('gender');
  if (profile.address === null || profile.address.trim() === '') missing.push('address');

  /*
   * PER SIDE, mirroring the server's `REQUIRED_DOCUMENTS`. A driver holding only the front of
   * their licence is not done, and a check that only asked "is there a LICENCE row?" would enable
   * Submit and then be contradicted by the 400 — the exact disagreement this file exists to avoid.
   */
  const held = new Set(documents.map((doc) => `${doc.doc_type}.${doc.side}`));
  for (const type of REQUIRED_DOCUMENT_TYPES) {
    for (const side of ['FRONT', 'BACK'] as const) {
      if (!held.has(`${type}.${side}`)) missing.push(`documents.${type}.${side}`);
    }
  }

  return missing;
}

/**
 * Which statuses a driver may submit from.
 *
 * `REJECTED` is included on purpose — rejection is not terminal. A driver fixes what the
 * rejection reason named and resubmits (docs/LLD/user.md §Driver verification). `SUBMITTED` is
 * excluded: resubmitting while already in the queue would reset the driver's place in it, so the
 * server refuses it with a 409 and the button must not offer it.
 */
export function canSubmit(status: DriverProfileDto['onboarding_status']): boolean {
  return status === 'INCOMPLETE' || status === 'REJECTED';
}
