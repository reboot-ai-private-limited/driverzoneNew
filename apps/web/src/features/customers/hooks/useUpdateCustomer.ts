'use client';

import type { AdminUpdateCustomerRequest } from '@driverzone/contracts';
import { customersApi } from '@/lib/api/endpoints/customers';
import { keys } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

export interface UpdateCustomerVars {
  id: string;
  patch: AdminUpdateCustomerRequest;
}

/**
 * Edit a customer's record.
 *
 * No optimistic update. This is somebody's name and phone number in a directory an admin is
 * about to act on — a row that shows the new value, then silently reverts when the write fails,
 * leaves them unable to say which of the two they actually saw.
 *
 * Invalidates the whole `customers` subtree rather than the one row: the list is paged and
 * sorted server-side, so renaming a customer can move them to a different page, and the row
 * that goes stale is always the one nobody thought about.
 */
export function useUpdateCustomer() {
  return useApiMutation<UpdateCustomerVars, unknown>({
    call: (token, { id, patch }) => customersApi.update(token, id, patch),
    invalidates: [keys.customers.all()],
    successMessage: 'Customer updated.',
  });
}
