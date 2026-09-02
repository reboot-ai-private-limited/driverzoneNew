import type {
  DutyStateDto,
  LocationPingDto,
  LocationPingsAcceptedDto,
  SendLocationPingsRequest,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  DutyStatus,
  SetDutyStatusRequest,
  DriverDocumentDto,
  DriverProfileDto,
  RequestDocumentUploadRequest,
  RequestDocumentUploadResponse,
  RequestProfilePictureUploadResponse,
  SubmitOnboardingResponse,
  UpdateDriverProfileRequest,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { getAccessToken } from '../../auth/session';
import { request } from '../client';

/**
 * `/driver/*` — the driver's own account surface
 * (apps/api/src/modules/identity/interface/driver.routes.ts). Every route here sits behind
 * `requireAuth('DRIVER')`, so each call carries the bearer.
 */

export function getProfile(): Promise<DriverProfileDto> {
  return request<DriverProfileDto>(`${ROLE_PREFIX}/profile`, {
    token: getAccessToken() ?? undefined,
  });
}

/**
 * PATCH semantics, and they are not the same as PUT: an omitted key leaves the field alone, an
 * explicit `null` clears it. Callers must therefore build the body by omission rather than
 * sending the whole form — sending `dob: undefined` for a field the driver never touched is
 * correct, sending `dob: null` would erase what is already stored.
 */
export function updateProfile(body: UpdateDriverProfileRequest): Promise<DriverProfileDto> {
  return request<DriverProfileDto>(`${ROLE_PREFIX}/profile`, {
    method: 'PATCH',
    body,
    token: getAccessToken() ?? undefined,
  });
}

export function listDocuments(): Promise<DriverDocumentDto[]> {
  return request<DriverDocumentDto[]>(`${ROLE_PREFIX}/documents`, {
    token: getAccessToken() ?? undefined,
  });
}

/**
 * Step one of the two-step upload: this records the row as `PENDING` and hands back a presigned
 * URL. The bytes then go straight to storage via `uploadFile` in `../client`, never through the
 * API (docs/LLD/architecture.md).
 */
export function requestDocumentUpload(
  body: RequestDocumentUploadRequest,
): Promise<RequestDocumentUploadResponse> {
  return request<RequestDocumentUploadResponse>(`${ROLE_PREFIX}/documents`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}

export function requestProfilePictureUpload(): Promise<RequestProfilePictureUploadResponse> {
  return request<RequestProfilePictureUploadResponse>(`${ROLE_PREFIX}/profile/picture-upload-url`, {
    method: 'POST',
    token: getAccessToken() ?? undefined,
  });
}

/**
 * "Review me." No body — everything the gate checks is already on the driver's record.
 *
 * A 400 carries `data.missing`, a list of dot-paths (`dob`, `documents.AADHAAR`). Read it via
 * `ApiError.missingFields` and point the driver at the exact field; a 409 means they are already
 * approved or already in the queue.
 */
export function submitOnboarding(): Promise<SubmitOnboardingResponse> {
  return request<SubmitOnboardingResponse>(`${ROLE_PREFIX}/onboarding/submit`, {
    method: 'POST',
    token: getAccessToken() ?? undefined,
  });
}

/**
 * Go on or off duty.
 *
 * Answers with the resulting STATE, not an echo of the request — a driver whose approval is
 * missing asks for ONLINE and is refused with a 409, and the app must not paint itself on duty
 * when dispatch will never ring it.
 */
export function setDuty(status: DutyStatus): Promise<DutyStateDto> {
  return request<DutyStateDto>(`${ROLE_PREFIX}/duty`, {
    method: 'POST',
    body: { status } satisfies SetDutyStatusRequest,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * A batch of GPS fixes. Never one request per fix — that drains a driver's battery and, at
 * scale, costs a driver base (docs/LLD/api-contracts.md).
 *
 * The response carries `is_on_duty` so a driver taken off duty server-side finds out within one
 * ping rather than on their next cold start.
 */
export function sendLocationPings(pings: LocationPingDto[]): Promise<LocationPingsAcceptedDto> {
  return request<LocationPingsAcceptedDto>(`${ROLE_PREFIX}/location`, {
    method: 'POST',
    body: { pings } satisfies SendLocationPingsRequest,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * Register this handset for push.
 *
 * Idempotent server-side, so the app calls it on every launch and every FCM token rotation
 * without checking whether anything changed — which is the only way to be sure a rotation is
 * never missed.
 */
export function registerDevice(body: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
  return request<RegisterDeviceResponse>(`${ROLE_PREFIX}/devices`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}
