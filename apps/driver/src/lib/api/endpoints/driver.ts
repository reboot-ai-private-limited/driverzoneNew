import type {
  AudienceSettingsResponse,
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
  DriverWalletDetailsDto,
  RequestDocumentUploadRequest,
  RequestDocumentUploadResponse,
  RequestProfilePictureUploadResponse,
  SubmitOnboardingResponse,
  TransactionType,
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

/**
 * `GET /driver/settings` — the flat key → value map of everything a DRIVER is allowed to see.
 *
 * Keys the other roles own are absent rather than null, so a caller reads what it needs and
 * tolerates a miss. The cancellation sheet is the first consumer: it states the penalty before a
 * driver commits to dropping a trip, and the two figures behind that
 * (`cancellation.driver_penalty_en_route` and `…_arrived`) are declared `DRIVER`-visible for
 * exactly this reason — never charge someone a penalty they were not shown.
 */
export function getDriverSettings(signal?: AbortSignal): Promise<AudienceSettingsResponse> {
  return request<AudienceSettingsResponse>(`${ROLE_PREFIX}/settings`, {
    token: getAccessToken() ?? undefined,
    signal,
  });
}

/**
 * What the earnings screen may narrow the statement by. Everything optional; nothing set reads the
 * whole statement, which is what the screen asks for until a chip is tapped.
 */
export interface EarningsFilter {
  /** Wire form is one comma-separated `type` parameter — see `LedgerQueryParams`. */
  types?: readonly TransactionType[] | undefined;
  /** `YYYY-MM-DD`, inclusive at both ends. */
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * `GET /driver/wallet` — the earnings screen's one call.
 *
 * Returns the balance, lifetime earnings, a summary of whatever the filter selects, and a page of
 * the ledger rows behind them. There is no driver id in the path: the server reads it off the
 * bearer, so this cannot be pointed at anyone else's earnings.
 *
 * FILTERING HAPPENS ON THE SERVER, and has to. The statement is paginated, so a filter applied
 * here would only search the pages already fetched and would silently miss every match further
 * back — which on a screen about money reads as "I was not paid for that trip".
 */
export function getEarnings(
  page = 1,
  limit = 20,
  filter: EarningsFilter = {},
): Promise<DriverWalletDetailsDto> {
  return request<DriverWalletDetailsDto>(`${ROLE_PREFIX}/wallet`, {
    query: {
      page,
      limit,
      // Omitted rather than sent empty: the server reads an absent key as "no filter", and an
      // empty `type=` would fail its `min(1)` check.
      ...(filter.types === undefined || filter.types.length === 0
        ? {}
        : { type: filter.types.join(',') }),
      ...(filter.from === undefined ? {} : { from: filter.from }),
      ...(filter.to === undefined ? {} : { to: filter.to }),
    },
    token: getAccessToken() ?? undefined,
  });
}
