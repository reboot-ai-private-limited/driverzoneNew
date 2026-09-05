import type { DocumentSide, DocumentType, OnboardingStatus } from '@driverzone/contracts';

/**
 * DOMAIN — the driver verification gate.
 *
 * Unlike a customer, whose profile completes progressively and is never required, a driver must
 * be complete and admin-approved before going on duty. The reason is not bureaucratic: an
 * unverified driver arrives at a stranger's pickup point and drives their car
 * (docs/decision-log.md, 2026-08-24).
 *
 * `missingForSubmission` is pure, and that matters twice over — it is both the gate and the
 * literal content of the 400 response body, so the thing the driver's app renders is the same
 * thing the server decided on.
 */

/**
 * Identity documents required before an admin will look at an application, BOTH SIDES OF EACH.
 *
 * PRESENCE, not verification: an admin verifies content at the next step, and a driver cannot
 * be asked to wait for approval before being allowed to ask for it. `POLICE_VERIFICATION` and
 * `OTHER` stay optional — the first is a document many drivers do not hold yet, and the second is
 * by definition whatever support happened to ask for.
 *
 * Both sides are required because half a licence proves nothing: the class and the expiry are
 * printed on the back of an Indian licence, which is exactly what an admin is checking.
 */
export const REQUIRED_DOCUMENTS: ReadonlyArray<{ docType: DocumentType; side: DocumentSide }> = [
  { docType: 'LICENCE', side: 'FRONT' },
  { docType: 'LICENCE', side: 'BACK' },
  { docType: 'GOVERNMENT_ID', side: 'FRONT' },
  { docType: 'GOVERNMENT_ID', side: 'BACK' },
];

/** The profile fields an admin needs in order to make a decision at all. */
export const REQUIRED_PROFILE_FIELDS = ['full_name', 'dob', 'gender', 'address'] as const;

export interface OnboardingProfile {
  fullName: string | null;
  dob: Date | null;
  gender: string | null;
  address: string | null;
}

/**
 * What is still missing, as dot-paths the client can deep-link from — `dob`,
 * `documents.LICENCE.BACK`.
 *
 * THE SIDE IS IN THE PATH. Telling a driver "driving licence" when only the back is missing sends
 * them to re-photograph a front that was already fine, and the retake is the step they abandon.
 *
 * An empty array means submittable. Returning the specific list rather than a boolean is
 * deliberate: "complete your profile" sends a driver hunting through every screen, and drivers
 * abandoning onboarding is a supply problem, not just a UX one.
 */
export function missingForSubmission(
  profile: OnboardingProfile,
  uploaded: ReadonlyArray<{ docType: DocumentType; side: DocumentSide }>,
): string[] {
  const missing: string[] = [];

  // Trimmed, because a whitespace-only name satisfies a null check and tells an admin nothing.
  if (profile.fullName === null || profile.fullName.trim() === '') missing.push('full_name');
  if (profile.dob === null) missing.push('dob');
  if (profile.gender === null || profile.gender === '') missing.push('gender');
  if (profile.address === null || profile.address.trim() === '') missing.push('address');

  const held = new Set(uploaded.map((doc) => `${doc.docType}.${doc.side}`));
  for (const required of REQUIRED_DOCUMENTS) {
    const path = `${required.docType}.${required.side}`;
    if (!held.has(path)) missing.push(`documents.${path}`);
  }

  return missing;
}

/**
 * Which statuses a driver may submit from.
 *
 * `REJECTED` is included on purpose — rejection is not terminal. A driver fixes what the
 * rejection reason named and resubmits (docs/LLD/user.md §Driver verification).
 * `SUBMITTED` is excluded: resubmitting while already in the queue is a no-op that would reset
 * the driver's place in it.
 */
export function canSubmit(status: OnboardingStatus): boolean {
  return status === 'INCOMPLETE' || status === 'REJECTED';
}

/**
 * Which statuses an admin may act on.
 *
 * Only `SUBMITTED`. Approving a driver who never applied would skip the completeness gate
 * entirely, which is the one thing that gate exists to prevent.
 */
export function canReview(status: OnboardingStatus): boolean {
  return status === 'SUBMITTED';
}
