import {
  GOVERNMENT_ID_KINDS,
  LICENCE_CLASSES,
  type DocumentSide,
  type DocumentType,
} from '@driverzone/contracts';

/**
 * Which metadata each document type actually has.
 *
 * The API accepts `number`, `sub_type`, `issued_on` and `expires_on` on every document type
 * (`requestDocumentUploadSchema` — all optional). Asking for all four every time would be the
 * easy build and a bad form: a government id has no expiry date and no class, so a driver either
 * invents one or stalls. `mobile-in-monorepo.md` is blunt that drivers abandoning onboarding is
 * a supply problem, and a form that asks for facts a document does not have is how that happens.
 *
 * So the shape is per-type, and the screen renders only what the document in hand can answer.
 *
 * **`expires_on` carries a product requirement.** `prd.md` FR-D6: *"Documents with expiry
 * tracking; expired documents block going on duty."* That rule is unenforceable unless the app
 * actually collects an expiry — which until now it never did, so every document looked
 * perpetually valid. The types below marked `expires` are the ones that make FR-D6 real.
 *
 * **Two-sided documents (2026-09-04).** A licence and a government id are photographed front and
 * back, as two separate uploads that an admin reviews separately. `sides` below says which faces
 * a type has; the metadata is asked ONCE, on the first upload, and rides on both — re-typing a
 * licence number to photograph its back is the sort of thing that ends an onboarding.
 */

export interface DocumentFieldSpec {
  /** The identifying number printed on the document. */
  number?: { label: string; placeholder: string; keyboard: 'default' | 'number-pad' };
  /**
   * The type-specific qualifier, sent as `sub_type`. `multi` means the driver may tick several
   * and the values are comma-joined — a real licence commonly carries LMV *and* MCWG.
   */
  subType?: {
    label: string;
    hint?: string;
    options: readonly string[];
    /** Prettier text for an option whose wire value is an enum member (`VOTER_ID` → `Voter ID`). */
    labels?: Readonly<Record<string, string>>;
    multi: boolean;
  };
  /** A free-text qualifier, also sent as `sub_type`. Mutually exclusive with `subType`. */
  subTypeText?: { label: string; placeholder: string };
  issued?: { label: string };
  expires?: { label: string };
  /** Which faces this document has. One entry means a single photo. */
  sides: readonly DocumentSide[];
}

const TWO_SIDED: readonly DocumentSide[] = ['FRONT', 'BACK'];
const ONE_SIDED: readonly DocumentSide[] = ['FRONT'];

const GOVERNMENT_ID_LABELS: Record<string, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN',
  VOTER_ID: 'Voter ID',
  PASSPORT: 'Passport',
};

export const DOCUMENT_FIELDS: Record<DocumentType, DocumentFieldSpec> = {
  LICENCE: {
    number: { label: 'Licence number', placeholder: 'WB-1420110012345', keyboard: 'default' },
    subType: {
      label: 'Class',
      hint: '(tick every one on your licence)',
      options: LICENCE_CLASSES,
      multi: true,
    },
    issued: { label: 'Issued on' },
    expires: { label: 'Valid until' },
    sides: TWO_SIDED,
  },
  GOVERNMENT_ID: {
    subType: { label: 'Which ID is this?', options: GOVERNMENT_ID_KINDS, labels: GOVERNMENT_ID_LABELS, multi: false },
    // No expiry: an Aadhaar or PAN card has none, and asking would be the invented field this
    // whole file exists to avoid. A passport does, but not enough of them to ask everybody.
    number: { label: 'ID number', placeholder: 'As printed on the ID', keyboard: 'default' },
    sides: TWO_SIDED,
  },
  POLICE_VERIFICATION: {
    // Station and date only. The certificate number was dropped on 2026-09-04: what an admin
    // actually checks is which station issued it and how recently.
    subTypeText: { label: 'Police station', placeholder: 'Which station issued it' },
    issued: { label: 'Issued on' },
    sides: ONE_SIDED,
  },
  OTHER: {
    subTypeText: { label: 'What is this document?', placeholder: 'Badge, PSV permit…' },
    sides: ONE_SIDED,
  },
};

/** How a `sub_type` value should read on screen — `VOTER_ID` → `Voter ID`, `LMV,MCWG` unchanged. */
export function describeSubType(type: DocumentType, value: string): string {
  return DOCUMENT_FIELDS[type].subType?.labels?.[value] ?? value;
}

/** The faces a type is photographed from. */
export function sidesOf(type: DocumentType): readonly DocumentSide[] {
  return DOCUMENT_FIELDS[type].sides;
}

export function sideLabel(side: DocumentSide): string {
  return side === 'FRONT' ? 'Front' : 'Back';
}

/** True when a type has something to ask, so the screen knows whether to open the form at all. */
export function hasFields(type: DocumentType): boolean {
  const spec = DOCUMENT_FIELDS[type];
  return (
    spec.number !== undefined ||
    spec.subType !== undefined ||
    spec.subTypeText !== undefined ||
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
