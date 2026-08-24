import type { DocumentType, OnboardingStatus } from '@driverzone/contracts';

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
 * Identity documents required before an admin will look at an application.
 *
 * PRESENCE, not verification: an admin verifies content at the next step, and a driver cannot
 * be asked to wait for approval before being allowed to ask for it. The other document types
 * (`VEHICLE_RC`, `INSURANCE`, `POLICE_VERIFICATION`) are optional here because the driver does
 * not supply the vehicle — the customer does (docs/LLD/12-open-questions.md Q5).
 */
export const REQUIRED_DOCUMENT_TYPES: DocumentType[] = ['LICENCE', 'AADHAAR'];

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
 * `documents.AADHAAR`.
 *
 * An empty array means submittable. Returning the specific list rather than a boolean is
 * deliberate: "complete your profile" sends a driver hunting through every screen, and drivers
 * abandoning onboarding is a supply problem, not just a UX one.
 */
export function missingForSubmission(
  profile: OnboardingProfile,
  uploadedDocTypes: readonly DocumentType[],
): string[] {
  const missing: string[] = [];

  // Trimmed, because a whitespace-only name satisfies a null check and tells an admin nothing.
  if (profile.fullName === null || profile.fullName.trim() === '') missing.push('full_name');
  if (profile.dob === null) missing.push('dob');
  if (profile.gender === null || profile.gender === '') missing.push('gender');
  if (profile.address === null || profile.address.trim() === '') missing.push('address');

  for (const docType of REQUIRED_DOCUMENT_TYPES) {
    if (!uploadedDocTypes.includes(docType)) missing.push(`documents.${docType}`);
  }

  return missing;
}

/**
 * Which statuses a driver may submit from.
 *
 * `REJECTED` is included on purpose — rejection is not terminal. A driver fixes what the
 * rejection reason named and resubmits (docs/LLD/13-auth-and-user.md §Driver verification).
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
