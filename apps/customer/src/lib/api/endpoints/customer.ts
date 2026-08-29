import type {
  CreateAddressRequest,
  CustomerProfileDto,
  SavedAddressDto,
  UpdateCustomerProfileRequest,
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
