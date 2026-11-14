/**
 * Auth and user wire types (docs/LLD/auth.md, docs/LLD/user.md).
 *
 * Types only, like everything else in this package — the API validates these shapes with Zod in
 * `identity/interface/identity.validation.ts`, and a compile-only assertion there checks the
 * inferred shape against the request types below in BOTH directions. That check is why a field
 * added to one side and not the other is a build failure rather than a runtime surprise in a
 * shipped store binary.
 */

export const ROLES = ['CUSTOMER', 'DRIVER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

/** The claims an access token carries. `aud` equals the role — that IS the audience check. */
export interface AuthPrincipal {
  /** The account id this token was issued for. */
  sub: string;
  role: Role;
}

// ─── OTP ────────────────────────────────────────────────────────────────────────────────────

/**
 * How the login code travels.
 *
 * WhatsApp is the default and carries its own SMS fallback on a delivery failure, so a client
 * that never sets this behaves exactly as every client did before the field existed.
 *
 * `SMS` IS THE CUSTOMER SAYING IT DID NOT ARRIVE. It skips WhatsApp entirely rather than trying
 * it again and waiting on the delivery check — the one thing already known about this attempt is
 * that WhatsApp did not work for them. It costs real money per message (see `sendOtp`'s caps),
 * which is why it is an explicit choice on the screen and never an automatic retry.
 */
export const OTP_CHANNELS = ['WHATSAPP', 'SMS'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export interface OtpSendRequest {
  mobile_number: string;
  /** Omitted means WhatsApp, with the server's own SMS fallback behind it. */
  channel?: OtpChannel | undefined;
}

/**
 * Identical for every role and every number, registered or not.
 *
 * Deliberate: a response that differs for a known number is how an attacker enumerates which
 * numbers have accounts — and, for `/admin/auth`, which numbers belong to staff.
 */
export interface OtpSendResponse {
  sent: true;
  expires_in_seconds: number;
  /** Seconds until another send is allowed. Lets a client render a countdown, not a dead wall. */
  retry_after_seconds: number;
}

export interface OtpVerifyRequest {
  mobile_number: string;
  otp: string;
}

export interface AuthUserDto {
  id: string;
  mobile_number: string;
  /** Null until the customer or driver fills it in — profiles complete progressively. */
  full_name: string | null;
}

export interface OtpVerifyResponse {
  /**
   * True on the first-ever verify for a number, when the account was created by this call.
   * Absent for `ADMIN`, whose accounts are never created by the auth flow.
   */
  is_new_user?: boolean;
  access_token: string;
  /** Omitted for `ADMIN` — the refresh token is set as an httpOnly cookie instead. */
  refresh_token?: string;
  user: AuthUserDto;
}

// ─── Session ────────────────────────────────────────────────────────────────────────────────

/**
 * Customer/driver send the token in the body; admin's is read from its cookie, so admin posts
 * no body at all.
 *
 * The explicit `| undefined` is not noise. `apps/api` compiles with
 * `exactOptionalPropertyTypes`, under which `?: string` and `?: string | undefined` are
 * different types — the first forbids `{ refresh_token: undefined }`, the second permits it.
 * Zod's `.optional()` produces the permissive one, and the compile-time drift guard in
 * `identity/interface/identity.typecheck.ts` compares the two exactly. Writing `?: string` here
 * fails the build rather than silently disagreeing with what the server actually accepts.
 */
export interface RefreshRequest {
  refresh_token?: string | undefined;
}

export interface RefreshResponse {
  access_token: string;
  /** Omitted for `ADMIN` — rotated into the cookie instead. */
  refresh_token?: string;
}

/** Same shape and same `| undefined` reasoning as `RefreshRequest`. */
export interface LogoutRequest {
  refresh_token?: string | undefined;
}

/** Always `true`, on every outcome. Logging out twice is not an error worth showing anyone. */
export interface LogoutResponse {
  logged_out: true;
}

// ─── Shared profile pieces ──────────────────────────────────────────────────────────────────

export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
export type Gender = (typeof GENDERS)[number];

export interface EmergencyContactDto {
  name: string;
  number: string;
}

/**
 * Every profile field is nullable, and that is the design rather than laziness.
 *
 * A customer account is created by `otp/verify` holding nothing but a phone number, and no
 * endpoint in this module ever requires more (docs/LLD/user.md §Customer). A client
 * must therefore be able to render a profile where everything except `mobile_number` is absent.
 */
export interface CustomerProfileDto {
  id: string;
  mobile_number: string;
  full_name: string | null;
  dob: string | null;
  gender: Gender | null;
  languages_known: string[];
  alternate_number: string | null;
  emergency_contact: EmergencyContactDto | null;
  /**
   * Optional WhatsApp promotional messages — off unless the customer opts in. Sign-in codes and
   * booking updates are transactional and are sent regardless of this flag.
   */
  whatsapp_marketing_opt_in: boolean;
  saved_addresses: SavedAddressDto[];
  vehicles: VehicleDto[];
}

/**
 * `PATCH` semantics: an omitted key leaves the field alone, an explicit `null` clears it.
 *
 * Those are genuinely different intents — "I'm only updating my name" versus "remove my
 * alternate number" — and a shape that could not express both would make clearing a field
 * impossible without a second endpoint.
 */
export interface UpdateCustomerProfileRequest {
  full_name?: string | undefined;
  dob?: string | null | undefined;
  gender?: Gender | null | undefined;
  languages_known?: string[] | undefined;
  alternate_number?: string | null | undefined;
  emergency_contact?: EmergencyContactDto | null | undefined;
  whatsapp_marketing_opt_in?: boolean | undefined;
}

// ─── Saved addresses ────────────────────────────────────────────────────────────────────────

export const ADDRESS_LABELS = ['HOME', 'OFFICE', 'OTHER'] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];

export interface SavedAddressDto {
  id: string;
  label: AddressLabel;
  address: string;
  lat: number;
  lng: number;
  /** Shown first in the address book. */
  is_default: boolean;
  /** Prefills the quote flow's pickup point. Independent of `is_default`. */
  is_preferred_pickup: boolean;
}

export interface CreateAddressRequest {
  label: AddressLabel;
  address: string;
  lat: number;
  lng: number;
  is_default?: boolean | undefined;
  is_preferred_pickup?: boolean | undefined;
}

export interface UpdateAddressRequest {
  label?: AddressLabel | undefined;
  address?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  is_default?: boolean | undefined;
  is_preferred_pickup?: boolean | undefined;
}

// ─── Vehicles ───────────────────────────────────────────────────────────────────────────────

export const FUEL_TYPES = ['PETROL', 'DIESEL', 'EV', 'CNG'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

/**
 * The car categories, as a closed list rather than a `carCategories` collection. The list is the
 * one in docs/LLD/domain-model.md §Glossary.
 *
 * IT IS NOT A PRICING DIMENSION. It used to be — a package carried a price row per category —
 * and that was retired on 2026-08-28 (docs/decision-log.md): an SUV and a hatchback now pay the
 * same fare for the same trip. What the category still decides is WHO CAN DRIVE: dispatch matches
 * a driver's competencies against the booking's category (docs/LLD/dispatch-and-assignment.md),
 * and a booking records the one it was placed for.
 *
 * It lives here rather than in `packages.ts` for exactly that reason — the consumers left are
 * drivers and bookings.
 */
export const CAR_CATEGORIES = ['MINI', 'HATCHBACK', 'SEDAN', 'SUV', 'LUXURY'] as const;
export type CarCategory = (typeof CAR_CATEGORIES)[number];

/** Display names. The code is what crosses the wire; this is only ever rendered. */
export const CAR_CATEGORY_LABELS: Record<CarCategory, string> = {
  MINI: 'Mini',
  HATCHBACK: 'Hatchback',
  SEDAN: 'Sedan',
  SUV: 'SUV',
  LUXURY: 'Luxury',
};

/**
 * The CUSTOMER's own car — the driver drives it rather than supplying one
 * (docs/LLD/open-questions.md Q5). `category` is a free string, not a car-category id: a
 * customer describes their car before any admin has to agree it maps to a priced category.
 */
export interface VehicleDto {
  id: string;
  category: string;
  plate_number: string;
  fuel_type: FuelType | null;
  is_default: boolean;
}

export interface CreateVehicleRequest {
  category: string;
  plate_number: string;
  fuel_type?: FuelType | undefined;
  is_default?: boolean | undefined;
}

export interface UpdateVehicleRequest {
  category?: string | undefined;
  plate_number?: string | undefined;
  fuel_type?: FuelType | undefined;
  is_default?: boolean | undefined;
}

// ─── Driver ─────────────────────────────────────────────────────────────────────────────────

export const ONBOARDING_STATUSES = ['INCOMPLETE', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

/**
 * How a car is driven, as opposed to what shape it is (`CAR_CATEGORIES` above).
 *
 * A SET PER DRIVER, NOT ONE VALUE. Someone who drives a manual almost always drives an automatic
 * too, and an EV is a third thing again — so a driver declares every type they can take and
 * dispatch matches the booking's type against that set. It was a single value until 2026-09-02;
 * with exact matching (a MANUAL booking rings only MANUAL-competent drivers) one value per driver
 * split the pool three ways and starved every wave.
 */
export const VEHICLE_TYPE_PREFERENCES = ['AUTO', 'MANUAL', 'EV'] as const;
export type VehicleTypePreference = (typeof VEHICLE_TYPE_PREFERENCES)[number];

/** Display names for the type a customer picks. `AUTO` is a gearbox, never an auto-rickshaw. */
export const VEHICLE_TYPE_LABELS: Record<VehicleTypePreference, string> = {
  AUTO: 'Automatic',
  MANUAL: 'Manual',
  EV: 'Electric',
};

export interface DriverProfileDto {
  id: string;
  mobile_number: string;
  full_name: string | null;
  profile_picture: string | null;
  dob: string | null;
  gender: Gender | null;
  experience_years: number | null;
  alternate_number: string | null;
  emergency_contact: EmergencyContactDto | null;
  address: string | null;

  /**
   * What this driver is COMPETENT to drive, not what they own — and the two gates dispatch
   * matches a booking against. EMPTY MEANS NO OFFERS, not "anything": a driver who has declared
   * nothing has not told us they can take an SUV, and guessing that they can is how a customer
   * ends up with a driver who cannot drive their car.
   */
  vehicle_type_preferences: VehicleTypePreference[];
  vehicle_category_preference: CarCategory[];

  /** Self-declared. Gates nothing on its own — hill dispatch reads the `_verified` flag. */
  can_drive_hill: boolean;
  can_drive_hill_verified: boolean;

  onboarding_status: OnboardingStatus;
  onboarding_rejection_reason: string | null;
  /** The single flag dispatch and `POST /driver/duty` gate on. */
  is_verified: boolean;

  /**
   * Whether the driver is currently on duty.
   *
   * SERVER STATE, not a client toggle. Dispatch reads `isOnDuty` off the driver record to decide
   * who to ring, so a driver "on duty" only in their app's memory would be offered nothing and
   * would not know it. The app renders this and changes it through `POST /driver/duty`.
   */
  is_on_duty: boolean;
}

export interface UpdateDriverProfileRequest {
  full_name?: string | undefined;
  profile_picture?: string | null | undefined;
  dob?: string | null | undefined;
  gender?: Gender | null | undefined;
  experience_years?: number | null | undefined;
  alternate_number?: string | null | undefined;
  emergency_contact?: EmergencyContactDto | null | undefined;
  address?: string | null | undefined;
  vehicle_type_preferences?: VehicleTypePreference[] | undefined;
  vehicle_category_preference?: CarCategory[] | undefined;
  can_drive_hill?: boolean | undefined;
}

// ─── Driver documents ───────────────────────────────────────────────────────────────────────

/**
 * What a driver uploads.
 *
 * `VEHICLE_RC` and `INSURANCE` were removed on 2026-09-04: the driver does not supply the vehicle
 * — the customer does (docs/LLD/open-questions.md Q5) — so asking a driver for the registration
 * and insurance of a car they will never own was asking for documents that do not exist. `AADHAAR`
 * became `GOVERNMENT_ID`, which carries WHICH id it is in `sub_type`, because a driver without an
 * Aadhaar card had no way to prove identity at all.
 */
export const DOCUMENT_TYPES = [
  'LICENCE',
  'GOVERNMENT_ID',
  'POLICE_VERIFICATION',
  'OTHER',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Which face of the document a file is.
 *
 * A licence and a government id are TWO ROWS, one per side, each uploaded and reviewed on its own.
 * An admin who can only reject "the licence" when the back is unreadable makes the driver
 * re-photograph both; per-side review says exactly which picture to take again.
 *
 * A single-sided document (a police verification letter, a free-form extra) is one `FRONT` row and
 * no `BACK`. There is no `SINGLE` member: it would mean the same thing as `FRONT` while forcing
 * every consumer to handle a third case.
 */
export const DOCUMENT_SIDES = ['FRONT', 'BACK'] as const;
export type DocumentSide = (typeof DOCUMENT_SIDES)[number];

/**
 * Which government id a `GOVERNMENT_ID` document is, stored in `sub_type`.
 *
 * Offered as choices rather than free text for the reason every enum here exists: three spellings
 * of "voter id" is an admin's problem forever, and `sub_type` is capped server-side anyway.
 */
export const GOVERNMENT_ID_KINDS = ['AADHAAR', 'PAN', 'VOTER_ID', 'PASSPORT'] as const;
export type GovernmentIdKind = (typeof GOVERNMENT_ID_KINDS)[number];

/**
 * Licence classes as issued in India, for `LICENCE.sub_type`.
 *
 * MULTI-VALUED, comma-joined — a real licence commonly carries several (LMV + MCWG), and forcing
 * one would make a driver misdeclare what they hold. Shared from contracts rather than kept in the
 * driver app so the admin panel renders the same set it is sent.
 */
export const LICENCE_CLASSES = ['LMV', 'LMV-NT', 'MCWG', 'HMV', 'HGMV', 'PSV'] as const;
export type LicenceClass = (typeof LICENCE_CLASSES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface DriverDocumentDto {
  id: string;
  doc_type: DocumentType;
  /** Which face this file is. See `DOCUMENT_SIDES`. */
  side: DocumentSide;
  status: DocumentStatus;
  /** Why an admin rejected it, so the driver knows what to re-upload. */
  rejection_reason: string | null;
  number: string | null;
  /**
   * The type-specific qualifier, one string for four different jobs:
   *
   *   - `LICENCE` — the classes held, comma-joined: `"LMV,MCWG"`
   *   - `GOVERNMENT_ID` — which id it is, a `GovernmentIdKind`
   *   - `POLICE_VERIFICATION` — the issuing police station
   *   - `OTHER` — what the driver called the document
   *
   * One field rather than four nullable ones because every use is "the thing that qualifies this
   * document type", and three permanently-null columns per row is a schema describing its own
   * exceptions. What it means is read off `doc_type`, which is always present.
   */
  sub_type: string | null;
  issued_on: string | null;
  expires_on: string | null;
  url: string;
}

export interface RequestDocumentUploadRequest {
  doc_type: DocumentType;
  /** Omit for `FRONT`. A single-sided document never sends `BACK`. */
  side?: DocumentSide | undefined;
  number?: string | undefined;
  /** See `DriverDocumentDto.sub_type` — what this carries depends on `doc_type`. */
  sub_type?: string | undefined;
  issued_on?: string | undefined;
  expires_on?: string | undefined;
}

/**
 * Two-step upload: the client sends the file straight to `upload_url`, never through the API
 * (docs/LLD/architecture.md). The row exists as `PENDING` from the moment this returns.
 *
 * **How to send depends on `upload_fields`, and the client must branch on it:**
 *
 *   - **present** — the provider needs a signed `multipart/form-data` **POST**. Send every
 *     key/value in `upload_fields` as a form field, plus the binary under `file`. Cloudinary
 *     works this way: its `api_key`/`timestamp`/`signature` are HMAC'd with the API secret
 *     server-side, so a client cannot construct them and an unsigned request is rejected 401.
 *   - **absent** — a plain **PUT** of the raw bytes to `upload_url`. This is the S3 presigned-URL
 *     shape, where the authorisation is baked into the query string.
 *
 * Do not send the fields as JSON, and do not add unsigned extras: the provider signs an exact
 * parameter set and rejects the upload if it does not match.
 */
export interface RequestDocumentUploadResponse {
  document_id: string;
  upload_url: string;
  expires_in_seconds: number;
  /** Form fields the provider requires. See above — present means POST multipart, absent means PUT. */
  upload_fields?: Record<string, string> | undefined;
}

/**
 * Same two-shape rule as `RequestDocumentUploadResponse` above — `upload_fields` present means a
 * signed multipart POST, absent means a plain PUT.
 *
 * Unlike a document, an avatar is uploaded PUBLIC (`isPrivate: false`), because it is shown to a
 * customer while their trip is running. `storage_key` is what the client then sends back as
 * `profile_picture` on `PATCH /driver/profile`.
 */
export interface RequestProfilePictureUploadResponse {
  upload_url: string;
  expires_in_seconds: number;
  storage_key: string;
  upload_fields?: Record<string, string> | undefined;
}

// ─── Onboarding ─────────────────────────────────────────────────────────────────────────────

export interface SubmitOnboardingResponse {
  onboarding_status: OnboardingStatus;
}

// ─── Admin ──────────────────────────────────────────────────────────────────────────────────

/**
 * What an admin may do. `SUPER_ADMIN` is everything `ADMIN` is, plus managing other admins and
 * deleting customer or driver accounts. An admin row that predates roles counts as `SUPER_ADMIN`,
 * which is exactly the power every admin had before this field existed.
 */
export const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export interface AdminProfileDto {
  id: string;
  mobile_number: string;
  full_name: string;
  /** Lets the panel hide what this admin cannot use. The server enforces it regardless. */
  admin_role: AdminRole;
}

/** One row of the admin roster (`GET /admin/admins`). SUPER_ADMIN only. */
export interface AdminUserDto {
  id: string;
  mobile_number: string;
  full_name: string;
  admin_role: AdminRole;
  is_active: boolean;
  created_at: string;
  deactivated_at: string | null;
}

export interface AdminUserListDto {
  admins: AdminUserDto[];
}

/**
 * `POST /admin/admins`. No invitation is sent — the new admin signs in with an OTP to this number
 * like any other admin, and until this row exists that number receives nothing.
 */
export interface CreateAdminUserRequest {
  mobile_number: string;
  full_name: string;
  admin_role: AdminRole;
}

/** `PATCH /admin/admins/:id`. The number is not editable: it is the credential. */
export interface UpdateAdminUserRequest {
  full_name?: string | undefined;
  admin_role?: AdminRole | undefined;
}

/** `mobile_number` is deliberately absent — it is the credential, not a self-service field. */
export interface UpdateAdminProfileRequest {
  full_name?: string | undefined;
}

export interface ApproveDriverResponse {
  onboarding_status: OnboardingStatus;
  is_verified: boolean;
}

export interface RejectDriverRequest {
  reason: string;
}

export interface RejectDriverResponse {
  onboarding_status: OnboardingStatus;
}

export interface VerifyHillDrivingRequest {
  verified: boolean;
}

export interface VerifyHillDrivingResponse {
  can_drive_hill_verified: boolean;
}

export interface SuspendDriverRequest {
  is_suspended: boolean;
  reason?: string;
}

export interface SuspendDriverResponse {
  is_suspended: boolean;
  reason?: string | null;
}

export interface ReviewDocumentRequest {
  status: DocumentStatus;
  reason?: string | undefined;
}

export interface ReviewDocumentResponse {
  document_id: string;
  status: DocumentStatus;
}

export interface AdminDriverListItemDto {
  id: string;
  mobile_number: string;
  full_name: string | null;
  profile_picture_url?: string | null;
  joined_at: string;
  last_ride_at: string | null;
  vehicle_type_preferences: VehicleTypePreference[];
  vehicle_category_preference: CarCategory[];
  can_drive_hill: boolean;
  can_drive_hill_verified: boolean;
  is_verified: boolean;
  is_on_duty: boolean;
  onboarding_status: OnboardingStatus;
  is_suspended: boolean;
  suspension_reason?: string | null;
  dl_expiry: string | null;
  dl_number?: string | null;
  address?: string | null;
  rating?: number | null;
  total_trips?: number | null;
}

export interface AdminDriverListDto {
  drivers: AdminDriverListItemDto[];
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

export interface AdminDriverDetailsDto {
  profile: DriverProfileDto & {
    is_suspended: boolean;
    suspension_reason?: string | null;
  };
  documents: DriverDocumentDto[];
}

// ─── Admin: customers ───────────────────────────────────────────────────────────────────────

/**
 * One row of `GET /admin/customers`.
 *
 * A FLATTENED view, not a `CustomerProfileDto`. The list shows one car and one place per
 * customer, so shipping every saved address and vehicle to render two cells would put kilobytes
 * of PII per row on the wire that the screen never draws. The full profile is one click away at
 * `GET /admin/customers/:id`.
 *
 * There is no serial number here. "Sl" is a row's position in the admin's current view — it
 * changes with the sort and the page — so it is computed in the browser, where that view exists.
 */
export interface AdminCustomerListItemDto {
  id: string;
  /** Null until they fill it in: an account is created by `otp/verify` holding only a phone. */
  full_name: string | null;
  mobile_number: string;
  /** ISO timestamp of account creation — the moment they first signed in. */
  joined_at: string;
  /** The default vehicle's plate, or the first if none is marked default. */
  car_number: string | null;
  /** Vehicles beyond `car_number`, so the cell can say "+2". */
  other_vehicle_count: number;
  /** Preferred-pickup address, falling back to the default. Free text, as the customer saved it. */
  location: string | null;
  /**
   * ALWAYS NULL until the bookings module exists (tier 6, docs/LLD/roadmap.md). The field ships
   * now so the column, the DTO and the renderer are written once; when bookings land this is the
   * only line that changes and no client is touched.
   */
  last_ride_at: string | null;
  /** Average out of 5. Null until ratings exist — same reasoning as `last_ride_at`. */
  rating: number | null;
  is_blocked: boolean;
}

/** Mirrors `AdminDriverListDto` — same envelope, so both admin lists paginate identically. */
export interface AdminCustomerListDto {
  customers: AdminCustomerListItemDto[];
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

/** The full record behind the View action: their own profile plus what only an admin sees. */
export interface AdminCustomerDetailsDto extends CustomerProfileDto {
  joined_at: string;
  /** Last write of any kind — the detail screen's "Last updated" line. */
  updated_at: string;
  is_blocked: boolean;
  last_ride_at: string | null;
  rating: number | null;
}

/**
 * What an ADMIN may change on someone else's account — deliberately narrower than the profile
 * the customer edits in their own app.
 *
 * Saved addresses and vehicles are absent: those are the customer's own records, and an admin
 * quietly rewriting where somebody lives is a change neither side can see happening.
 * `is_blocked` is the reverse — it belongs only here, since nobody blocks themselves. The mobile
 * number is absent because it IS the account: changing it is a migration, not a form field.
 *
 * Same PATCH semantics as everywhere: an omitted key leaves the field alone, an explicit `null`
 * clears it.
 */
export interface AdminUpdateCustomerRequest {
  full_name?: string | undefined;
  dob?: string | null | undefined;
  gender?: Gender | null | undefined;
  alternate_number?: string | null | undefined;
  is_blocked?: boolean | undefined;
}

/**
 * `POST /admin/customers` — an admin creates the account behind a phone number, so a trip can be
 * booked for somebody who has never opened the app.
 *
 * IDEMPOTENT ON THE NUMBER. A number that already has an account returns that account with
 * `created: false` rather than a 409: the admin's intent — "I need this customer" — is met either
 * way. The customer later signs in with the same number and finds the account (and the trip)
 * waiting.
 */
export interface AdminCreateCustomerRequest {
  /** E.164, e.g. `+919876543210`. */
  mobile_number: string;
  full_name?: string | undefined;
}

export interface AdminCreateCustomerResponse {
  customer: AdminCustomerDetailsDto;
  created: boolean;
}

/**
 * What an ADMIN may change on a driver's profile directly.
 */
export interface AdminUpdateDriverRequest {
  full_name?: string | undefined;
  dob?: string | null | undefined;
  gender?: Gender | null | undefined;
  experience_years?: number | null | undefined;
  alternate_number?: string | null | undefined;
  emergency_contact?: EmergencyContactDto | null | undefined;
  address?: string | null | undefined;
  vehicle_type_preferences?: VehicleTypePreference[] | undefined;
  vehicle_category_preference?: CarCategory[] | undefined;
  can_drive_hill?: boolean | undefined;
}

/**
 * Driver location entry for the live ops console and live map.
 */
export interface AdminLiveDriverDto {
  id: string;
  full_name: string | null;
  mobile_number: string;
  lat: number;
  lng: number;
  last_location_at: string;
  can_drive_hill: boolean;
  vehicle_categories: CarCategory[];
  is_on_duty: boolean;
}

export interface AdminLiveDriversResponse {
  drivers: AdminLiveDriverDto[];
  total_active: number;
}

export type DriverAlertType = 'DOCUMENT_EXPIRING' | 'DOCUMENT_EXPIRED' | 'WALLET_NEGATIVE';
export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM';

export interface AdminDriverAlertDto {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_phone: string;
  alert_type: DriverAlertType;
  severity: AlertSeverity;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminDriverAlertsResponse {
  alerts: AdminDriverAlertDto[];
  counts: {
    critical: number;
    high: number;
    medium: number;
    total: number;
  };
}

