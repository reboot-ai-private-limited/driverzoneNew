import type { CustomerProfileDto, Gender } from '@driverzone/contracts';

/** What the first-run profile form collects — only fields  stores. */
export interface ProfileDraft {
  fullName: string;
  gender: Gender | null;
  dob: Date | null;
}

export const EMPTY_DRAFT: ProfileDraft = {
  fullName: '',
  gender: null,
  dob: null,
};

/**
 * The dial's number, computed rather than fixed.
 *
 * The verified mobile number counts as one already-complete field: the account cannot exist
 * without it, so a customer arriving here is genuinely not starting from zero and a dial reading
 * 0% would be wrong as well as discouraging.
 *
 * Weighting every field equally is deliberate. A weighted score needs a rationale for each
 * weight, and there is no evidence to set them from — an arbitrary weighting dressed up as a
 * percentage is worse than an honest count.
 */
export function completionPercent(draft: ProfileDraft): number {
  const filled = [
    true, // mobile_number, verified at sign-in
    draft.fullName.trim().length > 0,
    draft.gender !== null,
    draft.dob !== null,
  ];
  const done = filled.filter(Boolean).length;
  return Math.round((done / filled.length) * 100);
}

/**
 * The account tab's own completion bar — over the STORED profile, not the onboarding draft
 * above. A different question: onboarding asks "how much of the form did you fill in before this
 * was ever saved", this asks "how much of what the API actually persists is filled in now". Same
 * equal-weight rule and the same reason for it — no evidence exists to weight one field over
 * another, so an even split is the honest reading rather than a dressed-up guess.
 *
 * The three Safety fields count here because the edit screen now collects them and the API has
 * always stored them (`languages_known`, `alternate_number`, `emergency_contact`). Leaving them
 * out would let a customer who filled in everything the form offers still see less than 100%,
 * which reads as the bar being broken.
 */
export function profileCompletionFromDto(profile: CustomerProfileDto): number {
  const filled = [
    true, // mobile_number — verified at sign-in, cannot be absent
    profile.full_name !== null && profile.full_name.trim().length > 0,
    profile.gender !== null,
    profile.dob !== null,
    profile.saved_addresses.length > 0,
    profile.languages_known.length > 0,
    profile.alternate_number !== null,
    profile.emergency_contact !== null,
  ];
  const done = filled.filter(Boolean).length;
  return Math.round((done / filled.length) * 100);
}

/** Same grouping the API uses, so the three toggles map straight onto `Gender`. */
export const GENDER_OPTIONS: ReadonlyArray<{ value: Gender; label: string }> = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
];

/**
 * The languages offered as one-tap chips on the profile form.
 *
 * Scoped to what is actually spoken in the operating region — Siliguri and the North Bengal
 * corridor — rather than a full ISO list nobody would scroll. `languages_known` on the wire is a
 * free array of strings (`z.array(z.string())` server-side), so a customer is never limited to
 * this set; it is the fast path, not the whole vocabulary. Kept as plain English labels because
 * that is what the value stored and shown is — there is no separate code/label split for it.
 */
export const LANGUAGE_OPTIONS: readonly string[] = [
  'English',
  'Hindi',
  'Bengali',
  'Nepali',
  'Bhojpuri',
  'Assamese',
];

/** The API takes `dob` as a date-only string; `toISOString` would send a timezone with it. */
export function toDateOnly(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatDob(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

