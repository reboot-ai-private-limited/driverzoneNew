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

export interface OtpSendRequest {
  mobile_number: string;
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
export const CAR_CATEGORIES = ['HATCHBACK', 'SEDAN', 'SUV', 'LUXURY', 'EV'] as const;
export type CarCategory = (typeof CAR_CATEGORIES)[number];

/** Display names. The code is what crosses the wire; this is only ever rendered. */
export const CAR_CATEGORY_LABELS: Record<CarCategory, string> = {
  HATCHBACK: 'Hatchback',
  SEDAN: 'Sedan',
  SUV: 'SUV',
  LUXURY: 'Luxury',
  EV: 'EV',
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

export const VEHICLE_TYPE_PREFERENCES = ['AUTO', 'MANUAL', 'EV'] as const;
export type VehicleTypePreference = (typeof VEHICLE_TYPE_PREFERENCES)[number];

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

  /** What this driver is COMPETENT to drive, not what they own. */
  vehicle_type_preference: VehicleTypePreference | null;
  vehicle_category_preference: string[];

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
  vehicle_type_preference?: VehicleTypePreference | null | undefined;
  vehicle_category_preference?: string[] | undefined;
  can_drive_hill?: boolean | undefined;
}

// ─── Driver documents ───────────────────────────────────────────────────────────────────────

export const DOCUMENT_TYPES = ['LICENCE', 'AADHAAR', 'POLICE_VERIFICATION', 'VEHICLE_RC', 'INSURANCE'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface DriverDocumentDto {
  id: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  /** Why an admin rejected it, so the driver knows what to re-upload. */
  rejection_reason: string | null;
  number: string | null;
  sub_type: string | null;
  issued_on: string | null;
  expires_on: string | null;
  url: string;
}

export interface RequestDocumentUploadRequest {
  doc_type: DocumentType;
  number?: string | undefined;
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

export interface AdminProfileDto {
  id: string;
  mobile_number: string;
  full_name: string;
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

export interface ReviewDocumentRequest {
  status: DocumentStatus;
  reason?: string | undefined;
}

export interface ReviewDocumentResponse {
  document_id: string;
  status: DocumentStatus;
}

export interface AdminDriverListDto {
  drivers: DriverProfileDto[];
  pagination: {
    page: number;
    limit: number;
    total_items: number;
    total_pages: number;
  };
}

export interface AdminDriverDetailsDto {
  profile: DriverProfileDto;
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
