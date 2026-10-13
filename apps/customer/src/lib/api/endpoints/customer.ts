import type {
  CreateAddressRequest,
  CreateVehicleRequest,
  CustomerProfileDto,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
  SavedAddressDto,
  UpdateCustomerProfileRequest,
  UpdateVehicleRequest,
  VehicleDto,
} from '@driverzone/contracts';
import { ROLE_PREFIX } from '../../config';
import { request } from '../client';
import { getAccessToken } from '../../auth/session';

/**
 * `/customer/*` — the customer's own account surface
 * (apps/api/src/modules/identity/interface/customer.routes.ts). Every route here sits behind
 * `requireAuth('CUSTOMER')`, so each call carries the bearer.
 */

export function getProfile(): Promise<CustomerProfileDto> {
  return request<CustomerProfileDto>(`${ROLE_PREFIX}/profile`, {
    token: getAccessToken() ?? undefined,
  });
}

/**
 * PATCH semantics, and they are not the same as PUT: an omitted key leaves the field alone, an
 * explicit `null` clears it. Callers must therefore build the body by omission rather than
 * sending the whole form — sending `dob: undefined` for a field the customer never touched is
 * correct, sending `dob: null` would erase what is already stored.
 */
export function updateProfile(body: UpdateCustomerProfileRequest): Promise<CustomerProfileDto> {
  return request<CustomerProfileDto>(`${ROLE_PREFIX}/profile`, {
    method: 'PATCH',
    body,
    token: getAccessToken() ?? undefined,
  });
}

export function addAddress(body: CreateAddressRequest): Promise<SavedAddressDto> {
  return request<SavedAddressDto>(`${ROLE_PREFIX}/addresses`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `DELETE /customer/addresses/:id`.
 *
 * The server re-homes the flags rather than leaving them dangling: removing the address that was
 * `is_default` or `is_preferred_pickup` promotes another one (`manageAddresses.usecase.ts`). So
 * the caller's job is only to invalidate the profile afterwards and re-read the list.
 */
export function removeAddress(id: string): Promise<void> {
  return request<void>(`${ROLE_PREFIX}/addresses/${id}`, {
    method: 'DELETE',
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `/customer/vehicles` — the customer's own cars (the driver drives the customer's car, so the
 * plate is how they find it). The list itself comes back on `getProfile().vehicles`.
 *
 * The first car saved becomes the default; setting `is_default` on another moves the default to
 * it (the server keeps at most one). A plate already saved is refused with 409.
 */
export function addVehicle(body: CreateVehicleRequest): Promise<VehicleDto> {
  return request<VehicleDto>(`${ROLE_PREFIX}/vehicles`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}

export function updateVehicle(id: string, body: UpdateVehicleRequest): Promise<VehicleDto> {
  return request<VehicleDto>(`${ROLE_PREFIX}/vehicles/${id}`, {
    method: 'PATCH',
    body,
    token: getAccessToken() ?? undefined,
  });
}

export function removeVehicle(id: string): Promise<void> {
  return request<void>(`${ROLE_PREFIX}/vehicles/${id}`, {
    method: 'DELETE',
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `POST /customer/devices` — register this handset for push.
 *
 * Idempotent server-side (`$addToSet`), so the app calls it on every sign-in and every FCM token
 * rotation without checking whether anything changed — the only way to be sure a rotation is not
 * missed. Without a registered token every ride update lands nowhere.
 *
 * Shares `RegisterDeviceRequest` with the driver app: the shape is role-agnostic and already
 * carries `platform`, so an iOS customer needs no new contract.
 */
export function registerDevice(body: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
  return request<RegisterDeviceResponse>(`${ROLE_PREFIX}/devices`, {
    method: 'POST',
    body,
    token: getAccessToken() ?? undefined,
  });
}

/**
 * `DELETE /customer/devices` — withdraw this handset on sign-out.
 *
 * Only this token, leaving the customer's other devices registered. The body carries the token
 * because the bearer identifies the customer, not the handset.
 */
export function removeDevice(fcmToken: string): Promise<void> {
  return request<void>(`${ROLE_PREFIX}/devices`, {
    method: 'DELETE',
    body: { fcm_token: fcmToken },
    token: getAccessToken() ?? undefined,
  });
}
