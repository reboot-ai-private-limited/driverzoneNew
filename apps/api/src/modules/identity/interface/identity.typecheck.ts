import type {
  CreateAddressRequest,
  CreateVehicleRequest,
  LogoutRequest,
  OtpSendRequest,
  OtpVerifyRequest,
  RefreshRequest,
  RejectDriverRequest,
  RequestDocumentUploadRequest,
  ReviewDocumentRequest,
  UpdateAddressRequest,
  UpdateAdminProfileRequest,
  UpdateCustomerProfileRequest,
  UpdateDriverProfileRequest,
  UpdateVehicleRequest,
} from '@driverzone/contracts';
import type {
  CreateAddressInput,
  CreateVehicleInput,
  LogoutInput,
  OtpSendInput,
  OtpVerifyInput,
  RefreshInput,
  RejectDriverInput,
  RequestDocumentUploadInput,
  ReviewDocumentInput,
  UpdateAddressInput,
  UpdateAdminProfileInput,
  UpdateCustomerProfileInput,
  UpdateDriverProfileInput,
  UpdateVehicleInput,
} from './identity.validation.js';

/**
 * Compile-only drift guard between the Zod schemas and the shared wire types.
 *
 * **This file is imported by nothing and emits nothing.** It exists so that `tsc --noEmit` fails
 * when `identity.validation.ts` and `@driverzone/contracts` disagree about a request shape.
 *
 * Why it exists at all: the API validates with Zod, but all four clients — the admin panel and
 * both store binaries — compile against the hand-authored types in `@driverzone/contracts`,
 * which by design contains no runtime code and therefore cannot be the validator. Two
 * representations of one shape will drift; the only question is whether they drift loudly.
 *
 * The check is deliberately TWO-WAY. The obvious spelling, `satisfies z.ZodType<Dto>`, only
 * proves the schema covers every field the DTO declares — it says nothing about a field the
 * schema has and the DTO does not, so a server that starts accepting a new field silently stops
 * matching what clients were built against. `AssertExact` catches both directions.
 */

/**
 * True only if `A` and `B` are mutually assignable.
 *
 * The conditional is wrapped in a tuple (`[A] extends [B]`) to stop TypeScript distributing over
 * unions — without it, a union type would be compared member-by-member and pass when it should
 * not.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/**
 * Each entry below resolves to `true` when the two shapes match and `false` when they do not.
 *
 * `AssertTrue` then rejects `false` at its constraint, so a drifted schema fails `tsc` with
 * "Type 'false' does not satisfy the constraint 'true'" pointing straight at the offending pair.
 */
type AssertTrue<T extends true> = T;

export type OtpSendMatches = AssertTrue<Exact<OtpSendInput, OtpSendRequest>>;
export type OtpVerifyMatches = AssertTrue<Exact<OtpVerifyInput, OtpVerifyRequest>>;
export type RefreshMatches = AssertTrue<Exact<RefreshInput, RefreshRequest>>;
export type LogoutMatches = AssertTrue<Exact<LogoutInput, LogoutRequest>>;

// ─── Phase 2 request shapes ─────────────────────────────────────────────────────────────────

export type UpdateCustomerProfileMatches = AssertTrue<
  Exact<UpdateCustomerProfileInput, UpdateCustomerProfileRequest>
>;
export type CreateAddressMatches = AssertTrue<Exact<CreateAddressInput, CreateAddressRequest>>;
export type UpdateAddressMatches = AssertTrue<Exact<UpdateAddressInput, UpdateAddressRequest>>;
export type CreateVehicleMatches = AssertTrue<Exact<CreateVehicleInput, CreateVehicleRequest>>;
export type UpdateVehicleMatches = AssertTrue<Exact<UpdateVehicleInput, UpdateVehicleRequest>>;
export type UpdateDriverProfileMatches = AssertTrue<
  Exact<UpdateDriverProfileInput, UpdateDriverProfileRequest>
>;
export type RequestDocumentUploadMatches = AssertTrue<
  Exact<RequestDocumentUploadInput, RequestDocumentUploadRequest>
>;
export type UpdateAdminProfileMatches = AssertTrue<
  Exact<UpdateAdminProfileInput, UpdateAdminProfileRequest>
>;
export type RejectDriverMatches = AssertTrue<Exact<RejectDriverInput, RejectDriverRequest>>;
export type ReviewDocumentMatches = AssertTrue<Exact<ReviewDocumentInput, ReviewDocumentRequest>>;
