import type { DocumentType } from '@driverzone/contracts';

/**
 * Which metadata each document type actually has.
 *
 * The API accepts `number`, `sub_type`, `issued_on` and `expires_on` on every document type
 * (`requestDocumentUploadSchema` — all optional). Asking for all four every time would be the
 * easy build and a bad form: an Aadhaar card has no expiry date and no class, so a driver either
 * invents one or stalls. `mobile-in-monorepo.md` is blunt that drivers abandoning onboarding is
 * a supply problem, and a form that asks for facts a document does not have is how that happens.
 *
 * So the shape is per-type, and the screen renders only what the document in hand can answer.
 *
 * **`expires_on` carries a product requirement.** `prd.md` FR-D6: *"Documents with expiry
 * tracking; expired documents block going on duty."* That rule is unenforceable unless the app
 * actually collects an expiry — which until now it never did, so every document looked
 * perpetually valid. The types below marked `expires` are the ones that make FR-D6 real.
 */

export interface DocumentFieldSpec {
  /** The identifying number printed on the document. */
  number?: { label: string; placeholder: string; keyboard: 'default' | 'number-pad' };
  /** A class or variant — only the licence has one in practice. */
  subType?: { label: string; placeholder: string; options: readonly string[] };
  issued?: { label: string };
  expires?: { label: string };
}

/**
 * Licence classes as issued in India. Offered as choices rather than free text because a driver
 * typing "lmv" / "LMV " / "L.M.V." gives an admin three spellings of one class to reconcile, and
 * `sub_type` is capped at 20 characters server-side anyway.
 */
const LICENCE_CLASSES = ['LMV', 'LMV-NT', 'MCWG', 'HMV', 'HGMV', 'PSV'] as const;

export const DOCUMENT_FIELDS: Record<DocumentType, DocumentFieldSpec> = {
  LICENCE: {
    number: { label: 'Licence number', placeholder: 'WB-1420110012345', keyboard: 'default' },
    subType: { label: 'Class', placeholder: 'Select a class', options: LICENCE_CLASSES },
    issued: { label: 'Issued on' },
    expires: { label: 'Valid until' },
  },
  AADHAAR: {
    // 12 digits, no expiry, no class. The whole reason this file is per-type.
    number: { label: 'Aadhaar number', placeholder: '0000 0000 0000', keyboard: 'number-pad' },
  },
  VEHICLE_RC: {
    number: { label: 'Registration number', placeholder: 'WB74AB1234', keyboard: 'default' },
    issued: { label: 'Registered on' },
    expires: { label: 'Valid until' },
  },
  INSURANCE: {
    number: { label: 'Policy number', placeholder: 'Policy number', keyboard: 'default' },
    issued: { label: 'Issued on' },
    expires: { label: 'Valid until' },
  },
  POLICE_VERIFICATION: {
    number: { label: 'Certificate number', placeholder: 'Certificate number', keyboard: 'default' },
    issued: { label: 'Issued on' },
    expires: { label: 'Valid until' },
  },
};

/** True when a type has nothing to ask, so the screen can skip straight to the photo picker. */
export function hasFields(type: DocumentType): boolean {
  const spec = DOCUMENT_FIELDS[type];
  return (
    spec.number !== undefined ||
    spec.subType !== undefined ||
    spec.issued !== undefined ||
    spec.expires !== undefined
  );
}

/**
 * `Date` → `YYYY-MM-DD`, in LOCAL time.
 *
 * `toISOString()` is the obvious call and it is wrong: it converts to UTC first, so an expiry
 * picked as 1 March in IST (UTC+5:30) serialises as 28 February — a document that expires a day
 * early, silently. These dates are what is printed on the card; they have no time zone.
 */
export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Whether a stored expiry is in the past.
 *
 * Compared date-only, not by timestamp: a licence expiring today is valid today, and
 * `new Date('2026-08-31') < new Date()` would call it expired from one minute past midnight.
 */
export function isExpired(isoDate: string | null): boolean {
  if (isoDate === null) return false;
  return isoDate < toIsoDate(new Date());
}
