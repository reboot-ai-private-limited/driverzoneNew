'use client';

import { useQuery } from '@tanstack/react-query';
import type { CreateAdminUserRequest, UpdateAdminUserRequest } from '@driverzone/contracts';
import { adminsApi } from '@/lib/api/endpoints/admins';
import { authedQueryOptions } from '@/lib/query/factory';
import { keys, staleTime } from '@/lib/query/keys';
import { useApiMutation } from '@/lib/query/mutation';

export function useAdmins() {
  return useQuery(
    authedQueryOptions({
      queryKey: keys.admins.list(),
      fetch: (token, signal) => adminsApi.list(token, signal),
      staleTime: staleTime.directory,
    }),
  );
}

/**
 * The writes. None is optimistic: each of them changes who can sign in to this panel, and a row
 * that shows "Deactivated" and then quietly flips back when the server refuses is exactly how
 * somebody walks away believing access was removed when it was not.
 */
export function useCreateAdmin() {
  return useApiMutation<CreateAdminUserRequest, unknown>({
    call: (token, body) => adminsApi.create(token, body),
    invalidates: [keys.admins.all()],
    successMessage: 'Admin added. They can sign in with an OTP to that number.',
  });
}

export function useUpdateAdmin() {
  return useApiMutation<{ id: string; patch: UpdateAdminUserRequest }, unknown>({
    call: (token, { id, patch }) => adminsApi.update(token, id, patch),
    invalidates: [keys.admins.all()],
    successMessage: 'Admin updated.',
  });
}

export function useSetAdminActive() {
  return useApiMutation<{ id: string; active: boolean }, unknown>({
    call: (token, { id, active }) =>
      active ? adminsApi.reactivate(token, id) : adminsApi.deactivate(token, id),
    invalidates: [keys.admins.all()],
  });
}
