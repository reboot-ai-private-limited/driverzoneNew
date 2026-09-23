import type {
  AccountDeletedDto,
  AdminDeleteAccountRequest,
  AdminUserDto,
  AdminUserListDto,
  CreateAdminUserRequest,
  UpdateAdminUserRequest,
} from '@driverzone/contracts';
import { request } from '../client';

/**
 * `/admin/admins` — the roster. Mirrors `apps/api/src/modules/identity/interface/admin.routes.ts`.
 *
 * Every call here is SUPER_ADMIN only. The panel hides the screen from an ordinary admin, but the
 * server is what enforces it — an ordinary admin who types the URL gets a 403 error state, not the
 * roster.
 *
 * Reads take a trailing `signal`; writes do not — the rule in `endpoints/zones.ts`.
 */
export const adminsApi = {
  list: (token: string, signal?: AbortSignal) =>
    request<AdminUserListDto>('/admin/admins', { token, signal }),

  create: (token: string, body: CreateAdminUserRequest) =>
    request<AdminUserDto>('/admin/admins', { method: 'POST', token, body }),

  update: (token: string, id: string, body: UpdateAdminUserRequest) =>
    request<AdminUserDto>(`/admin/admins/${id}`, { method: 'PATCH', token, body }),

  deactivate: (token: string, id: string) =>
    request<AdminUserDto>(`/admin/admins/${id}/deactivate`, { method: 'POST', token }),

  reactivate: (token: string, id: string) =>
    request<AdminUserDto>(`/admin/admins/${id}/reactivate`, { method: 'POST', token }),
};

/**
 * Closing a customer's or driver's account on their behalf — SUPER_ADMIN only, and irreversible.
 * Served by the `accounts` module, on the same prefixes as the directories.
 */
export const accountDeletionApi = {
  delete: (token: string, role: 'customers' | 'drivers', id: string, body: AdminDeleteAccountRequest) =>
    request<AccountDeletedDto>(`/admin/${role}/${id}/delete-account`, { method: 'POST', token, body }),
};
